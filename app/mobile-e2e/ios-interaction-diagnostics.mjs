import { closeSync, openSync, readSync, fstatSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { iosAppLogPids, iosAppPids } from './ios-processes.mjs';
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

export async function samplePinnedIosApp({ udid, pid, prefix, deadlineUtc, execute, now = Date.now, signal: handoffSignal }) {
  const remaining = Math.min(15000, Date.parse(deadlineUtc) - now());
  if (!Number.isSafeInteger(pid) || pid <= 1) return { status: 'unknown', pid: null };
  if (!Number.isFinite(remaining) || remaining <= 0) return { status: 'expired', pid };
  const deadlineSignal = AbortSignal.timeout(Math.floor(remaining));
  const signal = handoffSignal ? AbortSignal.any([handoffSignal, deadlineSignal]) : deadlineSignal;
  try {
    signal.throwIfAborted();
    const listing = await execute('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list'],
      { timeout: 5000, signal });
    writeFileSync(`${prefix}-processes.txt`, listing.stdout);
    const observedPids = iosAppPids(listing.stdout).map(Number);
    if (!observedPids.includes(pid)) {
      return { status: 'exited', pid, observedPids,
        reason: 'Pinned process is no longer this device\'s running app; no replacement sampled.' };
    }
    let frameError;
    signal.throwIfAborted();
    try {
      await execute('xcrun', ['simctl', 'io', udid, 'screenshot', `${prefix}.png`],
        { timeout: 5000, signal });
    } catch (error) {
      frameError = errorDetails(error);
      writeFileSync(`${prefix}-screenshot-error.json`, JSON.stringify(frameError, null, 2));
    }
    signal.throwIfAborted();
    const stats = await execute('ps', ['-p', String(pid), '-o', 'pid,ppid,%cpu,rss,state'],
      { timeout: 5000, signal });
    writeFileSync(`${prefix}-process-${pid}.txt`, stats.stdout);
    // Existing 10s debugger cap, within the same 15s overall failure budget.
    // This branch runs only after the test has actually failed and while its
    // request/ack handoff prevents the following scenario from relaunching.
    signal.throwIfAborted();
    const captured = await execute('sudo', ['-n', 'xcrun', 'lldb', '--no-lldbinit', '--batch',
      '--one-line-before-file', 'settings set target.preload-symbols false',
      '--one-line-before-file', 'settings set target.detach-on-error true',
      '--attach-pid', String(pid), '--one-line', 'thread backtrace -c 40 all',
      '--one-line', 'process detach'], { timeout: 10000, signal });
    writeFileSync(`${prefix}-stack-${pid}.txt`, captured.stdout + captured.stderr);
    return { status: frameError ? 'error' : 'captured', pid, ...(frameError ? { frameError } : {}) };
  } catch (error) {
    const details = errorDetails(error);
    writeFileSync(`${prefix}-stack-error.json`, JSON.stringify(details, null, 2));
    return { status: 'error', pid, error: details };
  }
}

export function iosInteractionDiagnostics({ artifacts, udid, nativeLog, execute,
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
          deadlineUtc: request.deadlineUtc, execute, now, signal })
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
