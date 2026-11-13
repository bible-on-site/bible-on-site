import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, homedir, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { iosHostLogArguments, startIosClassicHostLog, startNativeLog, stopNativeLogStreams } from "./native-logs.mjs";

const lifecycleEmitters = new Set(["CoreSimulatorService",
  "com.apple.CoreSimulator.CoreSimulatorService", "DeviceHub", "simulatord", "launchd_sim"]);

export function shutdownEvidence(log, udid) {
  return log.split(/\r?\n/).filter(line => {
    // Parse the record's first emitter, rather than matching a service name
    // quoted in its payload. Requester logs remain useful context, not proof.
    const emitter = /^(?:\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2}\s+\d{1,2})\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+(?:[^\s\[\]]+\s+){0,2}([A-Za-z_.]+)\[\d+(?::[a-f0-9]+)?\]/.exec(line)?.[1];
    return lifecycleEmitters.has(emitter) && line.toLowerCase().includes(udid.toLowerCase())
      && /\bshut(?:ting)?[ -]?down/i.test(line);
  });
}

// Consume the logger's pipe directly. macOS file watcher registration can
// miss an immediate write; a pipe buffers that output until its reader runs.
export function observeIosHostLog(udid) {
  const listeners = new Set();
  const partials = new Map();
  let startup = false, shutdown = false;
  return {
    write(chunk, source = "unified") {
      const lines = ((partials.get(source) ?? "") + chunk.toString()).split(/\r?\n/);
      const partial = lines.pop();
      partials.set(source, partial);
      // The bytes are already persisted even if the logger omits the final LF.
      // Inspect the partial record too, once its complete device ID is present.
      for (const line of [...lines, partial]) {
        startup ||= /Filtering the log data using/.test(line);
        shutdown ||= shutdownEvidence(line, udid).length > 0;
      }
      for (const inspect of [...listeners]) inspect();
    },
    async waitFor(stage, signal) {
      signal.throwIfAborted();
      await new Promise((accept, reject) => {
        const finish = error => {
          listeners.delete(inspect);
          signal.removeEventListener("abort", aborted);
          if (error) reject(error); else accept();
        };
        const inspect = () => { if (stage === "startup" ? startup : shutdown) finish(); };
        const aborted = () => finish(signal.reason);
        listeners.add(inspect);
        signal.addEventListener("abort", aborted, { once: true });
        inspect();
      });
    },
  };
}

// Called only after PR/queue tests and coverage finish. That job's simulator
// is no longer needed, and those events never publish a simulator-state cache.
// Verify the real state transition and reader lifecycle, then measure what the
// current OS logging configuration exposes. A missing vendor record is not
// evidence of a failed shutdown, nor proof of its reason or requesting client.
export async function verifyIosHostLog({ udid, artifact,
  execute = promisify(execFile), stream = startNativeLog, observe = observeIosHostLog,
  classicStream = startIosClassicHostLog, report = () => {}, signal,
  observationWindow = () => AbortSignal.timeout(5000), home = homedir() }) {
  assert.match(udid, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  // Reserve the existing five-second observer stop cap inside the 45s check.
  const operationDeadline = AbortSignal.timeout(40000);
  const deadline = signal ? AbortSignal.any([operationDeadline, signal]) : operationDeadline;
  deadline.throwIfAborted();
  const stateQueries = [];
  const devicePlist = join(home, "Library", "Developer", "CoreSimulator", "Devices", udid, "device.plist");
  const device = async () => {
    // Even UUID-filtered simctl listing blocks on service re-initialization
    // after shutdown. Read only the owned device's persisted identity/state.
    // CoreSimulator's numeric state mapping is also used by WebKit.
    const command = "/usr/bin/plutil";
    const reads = await Promise.allSettled(["UDID", "state"].map(async key => {
      const args = ["-extract", key, "raw", "-o", "-", devicePlist];
      const started = performance.now();
      try {
        return (await execute(command, args, { timeout: 5000, signal: deadline })).stdout.trim();
      } finally {
        const query = { command, args, elapsedMs: performance.now() - started };
        stateQueries.push(query);
        report({ udid, stage: "target state query", at: new Date().toISOString(), ...query });
      }
    }));
    // Join both bounded reads even on error; neither child may outlive us.
    for (const read of reads) if (read.status === "rejected") throw read.reason;
    const [identity, numeric] = reads.map(read => read.value);
    assert(identity.toUpperCase() === udid.toUpperCase() && /^[0-4]$/.test(numeric),
      "Refuse shutdown: invalid persisted simulator identity or state.");
    const numericState = Number(numeric);
    return { udid: identity, numericState, source: devicePlist,
      state: ["Creating", "Shutdown", "Booting", "Booted", "Shutting Down"][numericState] };
  };
  const before = { ...(await device()), at: new Date().toISOString() };
  assert.equal(before.state, "Booted", "Refuse shutdown without this job's booted simulator.");
  mkdirSync(dirname(artifact), { recursive: true });
  const evidence = observe(udid);
  const observer = stream("/usr/bin/log", iosHostLogArguments(), artifact,
    { onOutput: chunk => evidence.write(chunk) });
  const classicArtifact = `${artifact}.classic.log`;
  let classicObserver;
  let after, request;
  let observation;
  let observedInWindow = false;
  let stage;
  const enter = name => {
    stage = name;
    report({ udid, stage, at: new Date().toISOString() });
  };
  try {
    enter("host logger startup");
    classicObserver = classicStream(classicArtifact,
      { onOutput: chunk => evidence.write(chunk, "classic") });
    await evidence.waitFor("startup",
      AbortSignal.any([deadline, AbortSignal.timeout(5000)]));
    enter("owned simulator shutdown command");
    const args = ["simctl", "shutdown", udid];
    const shutdown = execute("xcrun", args, { timeout: 30000, signal: deadline });
    request = { command: "xcrun", args, pid: shutdown.child?.pid ?? null,
      requestedAt: new Date().toISOString() };
    report({ udid, stage, at: request.requestedAt, ...request });
    await shutdown;
    request.completedAt = new Date().toISOString();
    enter("shutdown state verification");
    after = { ...(await device()), at: new Date().toISOString() };
    assert.equal(after.state, "Shutdown");
    enter("observe service shutdown record");
    const window = observationWindow();
    observation = { startedAt: new Date().toISOString() };
    try {
      await evidence.waitFor("shutdown", AbortSignal.any([deadline, window]));
      observedInWindow = true;
    }
    catch (error) {
      // Only absence at this fixed observation boundary is a measurement.
      // Overall deadline/cancellation, startup and reader failures still fail.
      if (deadline.aborted || !window.aborted || error !== window.reason || error.name !== "TimeoutError") throw error;
    } finally { observation.endedAt = new Date().toISOString(); }
  } catch (cause) {
    throw new Error(`iOS host log verification failed during ${stage}: ${cause.message}`, { cause });
  } finally { await stopNativeLogStreams([observer, classicObserver]); }
  deadline.throwIfAborted();
  // Drained bytes include cleanup diagnostics. Only the completed observation
  // wait establishes whether a record arrived within its fixed window.
  const captures = { unified: readFileSync(artifact) };
  if (classicObserver) captures.classic = readFileSync(classicArtifact);
  const sources = Object.fromEntries(Object.entries(captures)
    .map(([source, bytes]) => [source, shutdownEvidence(bytes.toString("utf8"), udid).length]));
  const correlatedLines = Object.values(sources).reduce((sum, count) => sum + count, 0);
  const result = { kind: "ios-host-log-measurement/1", udid, stateTransitionVerified: true,
    before, after, request, stateQueries, observation, sources, correlatedLines,
    lifecycleRecordStatus: observedInWindow ? "observed" : "not-observed",
    limitation: observedInWindow ? null
      : "No service shutdown record observed in the fixed window; OS shutdown reason and requesting client are not established.",
    capturedBytes: Object.fromEntries(Object.entries(captures).map(([source, bytes]) => [source, bytes.length])),
    sourceSha: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null,
    host: { platform: process.platform, release: release(), arch: arch(), node: process.version } };
  writeFileSync(`${artifact}.measurement.json`, JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert(["pull_request", "merge_group"].includes(process.env.GITHUB_EVENT_NAME));
  assert.equal(process.env.MOBILE_PLATFORM, "iOS");
  assert(process.env.MOBILE_E2E_ARTIFACTS);
  const artifact = resolve(process.env.MOBILE_E2E_ARTIFACTS, "simulator-host-shutdown-contract.log");
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort(new DOMException("Host measurement cancelled", "AbortError"));
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    const result = await verifyIosHostLog({ udid: process.env.MOBILE_UDID,
      artifact, signal: cancellation.signal, report: event => console.log(JSON.stringify(event)) });
    console.log(JSON.stringify(result));
    if (result.limitation) console.log(`::notice::${result.limitation}`);
  } catch (error) {
    // Keep the short controlled capture visible even if artifact storage fails.
    for (const path of [artifact, `${artifact}.classic.log`, `${artifact}.classic.log.source.json`]) {
      if (existsSync(path)) console.error(`${path} (last 16 KiB):\n${readFileSync(path, "utf8").slice(-16384)}`);
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
