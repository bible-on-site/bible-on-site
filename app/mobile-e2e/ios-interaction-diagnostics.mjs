import { closeSync, openSync, readSync, fstatSync, writeFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { iosAppLogPids } from './ios-processes.mjs';
import { ownedIosTestAppProcesses } from './ios-app-cleanup.mjs';
import { captureNativeFrame } from './native-logs.mjs';

// Read only a bounded tail of the existing device-scoped stream. No process
// query or debugger may touch a potentially healthy app at the 25s threshold.
export function readLoggedIosAppPid(path) {
  const file = openSync(path, 'r');
  try {
    const size = fstatSync(file).size;
    const bytes = Buffer.alloc(Math.min(size, 128 * 1024));
    readSync(file, bytes, 0, bytes.length, size - bytes.length);
    return iosAppLogPids(bytes.toString('utf8')).at(-1) ?? null;
  } finally { closeSync(file); }
}

function errorDetails(error) {
  return { message: error.message, code: error.code, killed: error.killed,
    signal: error.signal, stdout: error.stdout, stderr: error.stderr };
}

// Kernel thread rows preserve an instantaneous host-kernel view:
// proc_pidinfo thread flavors copy proc-table state inside one syscall each —
// no task_for_pid, suspension, debugger handshake or CoreSimulator RPC.
// During the original stall a 5s simctl frame, a 10s lldb attach and (in a later
// run) a 1s `sample` all
// died inside their existing caps with zero output, while this inspector's
// kernel listing finished. The read does not touch the target, so it is also
// safe next to a potentially healthy app at the pending-request threshold.
// Each event records waiting/runnable state and thread names. CPU and sleep
// values may be zero or unavailable; these rows alone do not establish CPU
// occupancy, garbage collection or the call a waiting thread is blocked in.
async function capturePinnedThreads({ inspectorPath, pid, destination, errorPath, execute, options }) {
  let details;
  if (typeof inspectorPath !== 'string' || !posix.isAbsolute(inspectorPath)) {
    details = { message: 'Require the prepared native iOS process inspector.' };
  } else if (!Number.isSafeInteger(pid) || pid <= 1) {
    details = { message: 'No pinned app identity is available for kernel thread enumeration.' };
  }
  if (!details) {
    try {
      const listing = await execute(inspectorPath, ['--threads', String(pid)], options);
      writeFileSync(destination, listing.stdout);
      return null;
    } catch (error) {
      details = errorDetails(error);
    }
  }
  writeFileSync(errorPath, JSON.stringify(details, null, 2));
  return details;
}

export async function samplePinnedIosApp({ udid, pid, prefix, deadlineUtc, execute, inspectorPath, devicesRoot,
  now = Date.now, signal: handoffSignal }) {
  const startedAt = now();
  const remaining = Math.min(15000, Date.parse(deadlineUtc) - startedAt);
  if (!Number.isSafeInteger(pid) || pid <= 1) return { status: 'unknown', pid: null };
  if (!Number.isFinite(remaining) || remaining <= 0) return { status: 'expired', pid };
  const deadlineSignal = AbortSignal.timeout(Math.floor(remaining));
  const signal = handoffSignal ? AbortSignal.any([handoffSignal, deadlineSignal]) : deadlineSignal;
  const deadline = startedAt + remaining;
  let sampleError;
  function stackOptions(cap) {
    signal.throwIfAborted();
    const timeout = Math.floor(Math.min(cap, deadline - now()));
    if (timeout <= 0) throw new Error('Failure sampling deadline expired.');
    return { timeout, signal };
  }
  async function inspectPinnedProcess(options) {
    const listing = await execute(inspectorPath, [String(pid)], { ...options, windowsHide: true });
    if (listing.stderr?.trim()) throw new Error(`App process inspection failed: ${listing.stderr.trim()}`);
    const observedPids = ownedIosTestAppProcesses(listing.stdout, udid, devicesRoot)
      .filter(record => !record.state.startsWith('Z')).map(record => record.pid);
    return { listing: listing.stdout, observedPids };
  }
  try {
    signal.throwIfAborted();
    if (typeof inspectorPath !== 'string' || !posix.isAbsolute(inspectorPath)) {
      throw new Error('Require the prepared native iOS process inspector.');
    }
    // The simulator may be the stalled component. Confirm only the pinned
    // PID through the host kernel, without another CoreSimulator RPC or ps's
    // Mach task inspection. The executable path proves this device owns it.
    const { listing, observedPids } = await inspectPinnedProcess({ timeout: 5000, signal });
    writeFileSync(`${prefix}-processes.txt`, listing);
    if (!observedPids.includes(pid)) {
      return { status: 'exited', pid, observedPids,
        reason: 'Pinned process is no longer this device\'s running app; no replacement sampled.' };
    }
    writeFileSync(`${prefix}-process-${pid}.txt`, listing);
    let frameError;
    let threadsError;
    signal.throwIfAborted();
    // Existing 10s debugger cap, within the same 15s overall failure budget.
    // This branch runs only after the test has actually failed and while its
    // request/ack handoff prevents the following scenario from relaunching.
    // Capture the frame, kernel thread states and stack independently: a
    // stuck screenshot or a dead debugger must not consume the other's
    // budget. All finish before acknowledging failure.
    const [frame, threads, stack] = await Promise.allSettled([
      (async () => {
        try {
          await execute('xcrun', ['simctl', 'io', udid, 'screenshot', `${prefix}.png`],
            { timeout: 5000, signal });
        } catch (error) {
          frameError = errorDetails(error);
          writeFileSync(`${prefix}-screenshot-error.json`, JSON.stringify(frameError, null, 2));
        }
      })(),
      capturePinnedThreads({ inspectorPath, pid, execute,
        destination: `${prefix}-threads-${pid}.txt`,
        errorPath: `${prefix}-threads-error.json`,
        options: { timeout: 5000, signal } })
        .then(error => { threadsError = error; }),
      (async () => {
        // A one-second profile can preserve native call stacks even when a
        // later debugger handshake fails. Write directly to the artifact so
        // partial output survives a killed sample process. Never run sample
        // concurrently with LLDB, which would suspend its sampling target.
        try {
          await execute('/usr/bin/sample', [String(pid), '1', '-file', `${prefix}-sample-${pid}.txt`],
            stackOptions(5000));
        } catch (error) {
          sampleError = errorDetails(error);
          writeFileSync(`${prefix}-sample-error.json`, JSON.stringify(sampleError, null, 2));
        }
        // The pinned app can exit while sample runs. Prove ownership again
        // before a debugger may attach to a potentially reused host PID.
        const beforeDebugger = await inspectPinnedProcess(stackOptions(5000));
        writeFileSync(`${prefix}-before-debugger-processes.txt`, beforeDebugger.listing);
        if (!beforeDebugger.observedPids.includes(pid)) {
          throw new Error('Pinned process no longer belongs to this simulator; no debugger attached.');
        }
        const captured = await execute('sudo', ['-n', 'xcrun', 'lldb', '--no-lldbinit', '--batch',
          '--one-line-before-file', 'settings set target.preload-symbols false',
          '--one-line-before-file', 'settings set target.detach-on-error true',
          '--attach-pid', String(pid), '--one-line', 'thread backtrace -c 40 all',
          '--one-line', 'process detach'], stackOptions(10000));
        writeFileSync(`${prefix}-stack-${pid}.txt`, captured.stdout + captured.stderr);
      })(),
    ]);
    if (stack.status === 'rejected') throw stack.reason;
    if (frame.status === 'rejected') throw frame.reason;
    if (threads.status === 'rejected') throw threads.reason;
    return { status: (frameError || threadsError) ? 'error' : 'captured', pid,
      ...(frameError ? { frameError } : {}), ...(threadsError ? { threadsError } : {}),
      ...(sampleError ? { sampleError } : {}) };
  } catch (error) {
    const details = errorDetails(error);
    writeFileSync(`${prefix}-stack-error.json`, JSON.stringify(details, null, 2));
    return { status: 'error', pid, error: details, ...(sampleError ? { sampleError } : {}) };
  }
}

export function iosInteractionDiagnostics({ artifacts, udid, nativeLog, execute, inspectorPath, devicesRoot,
  readPid = () => readLoggedIosAppPid(nativeLog), now = Date.now }) {
  const records = [];
  return {
    async capture(command, request) {
      const prefix = resolve(artifacts, `native-interaction-${String(request.sequence).padStart(4, '0')}`);
      let pid = null;
      let identityError;
      try { pid = readPid(); }
      catch (error) {
        identityError = errorDetails(error);
        console.error("Could not read the pending interaction's passive app identity:", error.message);
      }
      const capturedRequest = Object.freeze({ sessionId: request.sessionId,
        startedAt: request.startedAt, capturedAt: request.capturedAt,
        pending: (request.capturedWhilePending ?? request.pending) === true });
      const record = { request, capturedRequest, pid, observedAt: new Date(now()).toISOString(),
        source: 'existing UDID-scoped native log', ...(identityError ? { identityError } : {}), prefix };
      records.push(record);
      writeFileSync(`${prefix}.json`, JSON.stringify(record, null, 2));
      writeFileSync(`${prefix}-command.txt`, command + (request.request ? ` ${request.request}` : ''));
      // The in-flight operation is the evidence: the kernel thread rows must
      // describe the same still-pending request, not a later post-mortem.
      const [frameError, threadsError] = await Promise.all([
        captureNativeFrame('xcrun', ['simctl', 'io', udid, 'screenshot'],
          `${prefix}.png`, execute),
        capturePinnedThreads({ inspectorPath, pid, execute,
          destination: `${prefix}-threads.txt`,
          errorPath: `${prefix}-threads-error.json`,
          options: { timeout: 5000, windowsHide: true } }),
      ]);
      if (frameError) {
        record.frameError = errorDetails(frameError);
        console.error("Could not capture the pending interaction frame:", frameError.message);
      }
      if (threadsError) {
        record.threadsError = threadsError;
        console.error("Could not capture the pending interaction's kernel thread states:", threadsError.message);
      }
      writeFileSync(`${prefix}.json`, JSON.stringify(record, null, 2));
      return record;
    },
    async failure(request, { signal } = {}) {
      const failedAt = Date.parse(request.failedAtUtc);
      const hasScenarioBoundary = request.scenarioStartedAtUtc != null;
      const scenarioStartedAt = typeof request.scenarioStartedAtUtc === 'string'
        ? Date.parse(request.scenarioStartedAtUtc) : NaN;
      const record = records.findLast(entry => {
        const captured = entry.capturedRequest;
        const capturedAt = Date.parse(captured.capturedAt);
        if (captured.sessionId !== request.sessionId || !Number.isFinite(failedAt)
          || !Number.isFinite(capturedAt) || capturedAt > failedAt) return false;
        if (!hasScenarioBoundary) {
          // Older callers cannot prove that a completed successful request
          // belongs to this scenario, so retain their conservative selection.
          return entry.request.pending || entry.request.status >= 400;
        }
        const startedAt = Date.parse(captured.startedAt);
        // A slow lookup can complete with HTTP 200 and an empty result before
        // its page poll fails. Keep its original pin only within this scenario.
        return captured.pending && Number.isFinite(scenarioStartedAt) && scenarioStartedAt <= failedAt
          && Number.isFinite(startedAt) && startedAt >= scenarioStartedAt
          && startedAt <= capturedAt && capturedAt >= scenarioStartedAt;
      });
      const prefix = resolve(artifacts, `native-failure-${request.id}`);
      const result = record
        ? await samplePinnedIosApp({ udid, pid: record.pid, prefix,
          deadlineUtc: request.deadlineUtc, execute, inspectorPath, devicesRoot, now, signal })
        : { status: 'unknown', pid: null, reason: 'No pending or failed request had a passively pinned app identity.' };
      writeFileSync(`${prefix}.json`, JSON.stringify({ request, observation: record ?? null, result }, null, 2));
      return result;
    },
  };
}

// After an uncertain observer shutdown, a later surviving app cannot be
// attributed to the failure. Only a confirmed absence of handoffs permits
// the legacy post-suite fallback.
export async function sampleIosFallback(observer, confirmed, sample) {
  if (!confirmed || observer?.received !== 0) {
    return { status: 'unknown', reason: 'Failure handoff observed or observer completion uncertain; no later app sampled.' };
  }
  await sample();
  return { status: 'fallback-attempted' };
}
