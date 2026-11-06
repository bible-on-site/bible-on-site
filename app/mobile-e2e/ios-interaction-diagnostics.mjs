import { closeSync, existsSync, openSync, readFileSync, readSync, fstatSync, writeFileSync } from 'node:fs';
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

function validateNativeSample(report, pid, executable) {
  const processId = report.match(/^Process:\s+[^\r\n]*\[(\d+)\]\s*$/m)?.[1];
  const processPath = report.match(/^Path:[ \t]+([^\r\n]+)$/m)?.[1]?.trim();
  const graphStart = report.indexOf('\nCall graph:');
  const imagesStart = report.indexOf('\nBinary Images:', graphStart);
  const graph = graphStart >= 0 && imagesStart > graphStart ? report.slice(graphStart, imagesStart) : '';
  if (Number(processId) !== pid || processPath !== executable ||
      !/^\s+\d+\s+Thread_\d+/m.test(graph) || !/\[0x[0-9a-f]+\]/i.test(graph)) {
    throw new Error('Native sample did not retain the pinned process identity and a native thread call graph.');
  }
}

export async function samplePinnedIosApp({ udid, pid, prefix, deadlineUtc, execute, inspectorPath, devicesRoot,
  now = Date.now, signal: handoffSignal }) {
  const remaining = Math.min(15000, Date.parse(deadlineUtc) - now());
  if (!Number.isSafeInteger(pid) || pid <= 1) return { status: 'unknown', pid: null };
  if (!Number.isFinite(remaining) || remaining <= 0) return { status: 'expired', pid };
  const deadlineSignal = AbortSignal.timeout(Math.floor(remaining));
  const signal = handoffSignal ? AbortSignal.any([handoffSignal, deadlineSignal]) : deadlineSignal;
  try {
    signal.throwIfAborted();
    if (typeof inspectorPath !== 'string' || !posix.isAbsolute(inspectorPath)) {
      throw new Error('Require the prepared native iOS process inspector.');
    }
    // The simulator may be the stalled component. Confirm only the pinned
    // PID through the host kernel, without another CoreSimulator RPC or ps's
    // Mach task inspection. The executable path proves this device owns it.
    const listing = await execute(inspectorPath, [String(pid)],
      { timeout: 5000, signal, windowsHide: true });
    if (listing.stderr?.trim()) throw new Error(`App process inspection failed: ${listing.stderr.trim()}`);
    writeFileSync(`${prefix}-processes.txt`, listing.stdout);
    const ownedProcesses = ownedIosTestAppProcesses(listing.stdout, udid, devicesRoot)
      .filter(record => !record.state.startsWith('Z'));
    const observedPids = ownedProcesses.map(record => record.pid);
    if (!observedPids.includes(pid)) {
      return { status: 'exited', pid, observedPids,
        reason: 'Pinned process is no longer this device\'s running app; no replacement sampled.' };
    }
    writeFileSync(`${prefix}-process-${pid}.txt`, listing.stdout);
    const stackPath = `${prefix}-stack-${pid}.txt`;
    if (existsSync(stackPath)) throw new Error('Refuse to overwrite an earlier native sample.');
    let frameError;
    signal.throwIfAborted();
    // Keep the existing 10s stack cap and 15s overall failure budget. The OS
    // sampler avoids starting/attaching a debugger when LLDB cannot initialize.
    // This branch runs only after the test has actually failed and while its
    // request/ack handoff prevents the following scenario from relaunching.
    // Capture the frame and stack independently: a stuck screenshot must not
    // consume the stack collector's budget. Both finish before acknowledging failure.
    const [frame, stack] = await Promise.allSettled([
      (async () => {
        try {
          await execute('xcrun', ['simctl', 'io', udid, 'screenshot', `${prefix}.png`],
            { timeout: 5000, signal });
        } catch (error) {
          frameError = errorDetails(error);
          writeFileSync(`${prefix}-screenshot-error.json`, JSON.stringify(frameError, null, 2));
        }
      })(),
      (async () => {
        writeFileSync(`${prefix}-sampler.json`, JSON.stringify({ tool: '/usr/bin/sample', pid,
          executable: ownedProcesses.find(record => record.pid === pid).executable,
          durationSeconds: 1, intervalMilliseconds: 1, commandLimitMs: 10000, deadlineUtc }, null, 2), { flag: 'wx' });
        const captured = await execute('sudo', ['-n', '/usr/bin/sample', String(pid), '1', '1',
          '-file', stackPath], { timeout: 10000, signal });
        writeFileSync(`${prefix}-sampler-output.txt`, captured.stdout + captured.stderr, { flag: 'wx' });
        validateNativeSample(readFileSync(stackPath, 'utf8'), pid,
          ownedProcesses.find(record => record.pid === pid).executable);
      })(),
    ]);
    if (stack.status === 'rejected') throw stack.reason;
    if (frame.status === 'rejected') throw frame.reason;
    return { status: frameError ? 'error' : 'captured', pid, ...(frameError ? { frameError } : {}) };
  } catch (error) {
    const details = errorDetails(error);
    writeFileSync(`${prefix}-stack-error.json`, JSON.stringify(details, null, 2));
    return { status: 'error', pid, error: details };
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
      const record = { request, pid, observedAt: new Date(now()).toISOString(),
        source: 'existing UDID-scoped native log', ...(identityError ? { identityError } : {}), prefix };
      records.push(record);
      writeFileSync(`${prefix}.json`, JSON.stringify(record, null, 2));
      writeFileSync(`${prefix}-command.txt`, command + (request.request ? ` ${request.request}` : ''));
      const frameError = await captureNativeFrame('xcrun', ['simctl', 'io', udid, 'screenshot'],
        `${prefix}.png`, execute);
      if (frameError) {
        record.frameError = errorDetails(frameError);
        console.error("Could not capture the pending interaction frame:", frameError.message);
      }
      writeFileSync(`${prefix}.json`, JSON.stringify(record, null, 2));
      return record;
    },
    async failure(request, { signal } = {}) {
      // Successful earlier requests (for example the calendar) cannot provide
      // a later test's identity. A failed native command may already be gone.
      const failedAt = Date.parse(request.failedAtUtc);
      const record = records.findLast(entry => entry.request.sessionId === request.sessionId
        && Date.parse(entry.request.capturedAt) <= failedAt
        && (entry.request.pending || entry.request.status >= 400));
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
