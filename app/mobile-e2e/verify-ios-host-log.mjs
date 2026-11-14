import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { arch, homedir, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { iosHostDebugProbeArguments, iosHostLogArguments, iosHostPosthocArguments,
  startIosClassicHostLog, startNativeLog, stopNativeLogStreams } from "./native-logs.mjs";

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

// Every record naming the device — regardless of vocabulary — is context for
// what the OS chose to persist about this transition. A nonempty file or a
// matching predicate string is not proof; the samples are.
export function udidRecords(log, udid) {
  const needle = udid.toLowerCase();
  return log.split(/\r?\n/).filter(line => line.toLowerCase().includes(needle));
}

// Records carrying the requesting client's pid — simctl[pid] on the client
// side or the service's peer[pid] XPC endpoint — are observed presence of
// who connected. They never prove what that client asked for.
export function clientRecords(log, pid) {
  if (!Number.isInteger(pid)) return [];
  const open = `[${pid}:`, closed = `[${pid}]`;
  return log.split(/\r?\n/).filter(line => line.includes(open) || line.includes(closed));
}

// Keep the measurement readable: bounded excerpts, with the full capture
// remaining in the sibling log artifacts.
function sampleLines(lines, limit = 3, length = 400) {
  return lines.slice(0, limit).map(line => line.length > length ? `${line.slice(0, length)}…` : line);
}

// Consume the logger's pipe directly. macOS file watcher registration can
// miss an immediate write; a pipe buffers that output until its reader runs.
// Each piped source confirms its own startup: a shutdown issued while a
// reader is still attaching would measure a gap we created ourselves.
export function observeIosHostLog(udid, { startupSources = ["unified"] } = {}) {
  const listeners = new Set();
  const partials = new Map();
  const started = new Set();
  let shutdown = false;
  return {
    write(chunk, source = "unified") {
      const lines = ((partials.get(source) ?? "") + chunk.toString()).split(/\r?\n/);
      const partial = lines.pop();
      partials.set(source, partial);
      // The bytes are already persisted even if the logger omits the final LF.
      // Inspect the partial record too, once its complete device ID is present.
      for (const line of [...lines, partial]) {
        if (/Filtering the log data using/.test(line)) started.add(source);
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
        const inspect = () => {
          if (stage === "startup" ? startupSources.every(source => started.has(source)) : shutdown) finish();
        };
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
  // The measurement adds bounded stages (environment, debug persistence, a
  // post-hoc query) to the unchanged per-interaction caps.
  const operationDeadline = AbortSignal.timeout(60000);
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
  const evidence = observe(udid, { startupSources: ["unified", "debug"] });
  const observers = [];
  const probeArtifact = `${artifact}.debug.log`;
  const classicArtifact = `${artifact}.classic.log`;
  const deviceArtifact = `${artifact}.device.log`;
  const deviceLogPath = join(home, "Library", "Logs", "CoreSimulator", udid, "system.log");
  const deviceLog = { path: deviceLogPath, offset: null };
  let classicObserver, deviceObserver;
  let after, request, observation, environment, debugPersistence, posthoc;
  let observedInWindow = false;
  let stage = "observer startup";
  const enter = name => {
    stage = name;
    report({ udid, stage, at: new Date().toISOString() });
  };
  // Measurement inputs are recorded, not asserted: a missing source or a
  // rejected probe is itself a finding about what this host exposes.
  const probe = async (command, args, options = {}) => {
    const started = performance.now();
    try {
      const output = await execute(command, args,
        { timeout: 10000, signal: deadline, ...options });
      return { command, args, status: "captured",
        stdout: output.stdout?.trim() ?? "", elapsedMs: performance.now() - started };
    } catch (error) {
      return { command, args, status: "failed", error: error.message,
        stdout: error.stdout?.trim() ?? "", elapsedMs: performance.now() - started };
    }
  };
  try {
    enter("host logger startup");
    // Register each reader as it attaches so a later stream that fails to
    // open cannot strand the ones already running.
    // The helper contract under measurement stays at info level; the debug
    // probe beside it tests whether the level — not the OS — drops the record.
    observers.push(stream("/usr/bin/log", iosHostLogArguments(), artifact,
      { onOutput: chunk => evidence.write(chunk, "unified") }));
    observers.push(stream("/usr/bin/log", iosHostDebugProbeArguments(), probeArtifact,
      { onOutput: chunk => evidence.write(chunk, "debug") }));
    classicObserver = classicStream(classicArtifact,
      { onOutput: chunk => evidence.write(chunk, "classic") });
    if (classicObserver) observers.push(classicObserver);
    try {
      // A per-device system.log persists in-device shutdown records — where a
      // lifecycle emitter could write what host-side processes never see.
      const status = statSync(deviceLogPath);
      if (status.isFile()) deviceLog.offset = status.size;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    }
    if (deviceLog.offset !== null) {
      deviceObserver = stream("/usr/bin/tail",
        ["-c", `+${deviceLog.offset + 1}`, "-F", deviceLogPath], deviceArtifact,
        { onOutput: chunk => evidence.write(chunk, "device") });
      observers.push(deviceObserver);
    }
    await evidence.waitFor("startup",
      AbortSignal.any([deadline, AbortSignal.timeout(5000)]));
    enter("environment capture");
    const [swVers, xcode, runtime, debugConfig] = await Promise.all([
      probe("/usr/bin/sw_vers", []),
      probe("/usr/bin/xcodebuild", ["-version"], { timeout: 15000 }),
      probe("/usr/bin/plutil",
        ["-extract", "runtime", "raw", "-o", "-", devicePlist], { timeout: 5000 }),
      // Debug records reach the post-hoc store only where persistence is
      // enabled too — emission and persistence are configured separately.
      // Enable both so "absent at debug" is an observed claim, not a guess.
      probe("/usr/bin/sudo",
        ["-n", "/usr/bin/log", "config", "--mode", "level:debug,persist:debug",
          "--subsystem", "com.apple.CoreSimulator"]),
    ]);
    debugPersistence = { ...debugConfig, restored: null };
    environment = { swVers, xcode, deviceRuntime: runtime, deviceLog };
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
    enter("post-hoc log query");
    const posthocArtifact = `${artifact}.posthoc.log`;
    // Bound the persisted-store query to this measurement: a wider `--last`
    // window could return an earlier shutdown of the same device and look
    // like evidence for the controlled one.
    const windowSeconds = Math.max(1,
      Math.ceil((Date.now() - Date.parse(before.at)) / 1000) + 1);
    const sweep = await probe("/usr/bin/log", iosHostPosthocArguments(windowSeconds),
      { timeout: 15000, maxBuffer: 64 * 1024 * 1024 });
    // Persist even a partial/timed-out sweep; its bytes are still evidence.
    // The full output stays in the artifact — the measurement keeps only
    // its size so the JSON stays small.
    writeFileSync(posthocArtifact, sweep.stdout);
    const { stdout: _stdout, ...summary } = sweep;
    posthoc = { ...summary, stdoutBytes: sweep.stdout.length, artifact: posthocArtifact };
  } catch (cause) {
    throw new Error(`iOS host log verification failed during ${stage}: ${cause.message}`, { cause });
  } finally {
    try {
      await stopNativeLogStreams(observers);
    } finally {
      // A failed reader cleanup must not strand the enabled persistence.
      // Cleanup gets its own budget: the aborted operation signal would
      // reject the reset before it runs.
      if (debugPersistence?.status === "captured") {
        const reset = await probe("/usr/bin/sudo",
          ["-n", "/usr/bin/log", "config", "--reset", "--subsystem", "com.apple.CoreSimulator"],
          { signal: AbortSignal.timeout(10000) });
        debugPersistence.restored = reset.status === "captured";
        debugPersistence.resetError = reset.error ?? null;
        report({ udid, stage: "debug persistence restore", at: new Date().toISOString(),
          status: reset.status, error: reset.error ?? null });
      }
    }
  }
  deadline.throwIfAborted();
  // Drained bytes include cleanup diagnostics. Only the completed observation
  // wait establishes whether a record arrived within its fixed window.
  const captures = { unified: readFileSync(artifact), debug: readFileSync(probeArtifact) };
  if (classicObserver) captures.classic = readFileSync(classicArtifact);
  if (deviceObserver) captures.device = readFileSync(deviceArtifact);
  if (posthoc) captures.posthoc = readFileSync(`${artifact}.posthoc.log`);
  const sources = Object.fromEntries(Object.entries(captures)
    .map(([source, bytes]) => [source, shutdownEvidence(bytes.toString("utf8"), udid).length]));
  const correlatedLines = Object.values(sources).reduce((sum, count) => sum + count, 0);
  const udidCorrelated = Object.fromEntries(Object.entries(captures)
    .map(([source, bytes]) => [source, udidRecords(bytes.toString("utf8"), udid).length]));
  const requesterLines = Object.values(captures)
    .flatMap(bytes => clientRecords(bytes.toString("utf8"), request?.pid));
  // The helper contract is the info-level unified stream plus the classic
  // file log. A record any other probe retains is a collection gap to fix.
  const helperCorrelated = (sources.unified ?? 0) + (sources.classic ?? 0);
  const collectionGap = helperCorrelated === 0 && correlatedLines > 0;
  const limitation = observedInWindow
    ? collectionGap
      ? "A shutdown record exists in the augmented capture but the helper's info-level contract does not retain it; collection correction is required."
      : null
    : correlatedLines > 0
      ? "No service shutdown record arrived inside the fixed window, though out-of-window bytes retain one; the fixed window, not the OS, is the limit here."
      : "No service shutdown record observed in the fixed window or the post-hoc sweep; OS shutdown reason and requesting client are not established at the probed sources and levels.";
  const result = { kind: "ios-host-log-measurement/2", udid, stateTransitionVerified: true,
    before, after, request, stateQueries, observation, environment, debugPersistence, posthoc,
    sources, correlatedLines, udidCorrelated,
    requestingClient: { pid: request?.pid ?? null,
      records: requesterLines.length, samples: sampleLines(requesterLines) },
    samples: { shutdown: sampleLines(Object.values(captures)
      .flatMap(bytes => shutdownEvidence(bytes.toString("utf8"), udid))) },
    collectionGap,
    lifecycleRecordStatus: observedInWindow ? "observed"
      : correlatedLines > 0 ? "after-window" : "not-observed",
    limitation,
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
    if (result.collectionGap) console.log(`::warning::${result.limitation}`);
    else if (result.limitation) console.log(`::notice::${result.limitation}`);
  } catch (error) {
    // Keep the short controlled capture visible even if artifact storage fails.
    for (const path of [artifact, `${artifact}.debug.log`, `${artifact}.classic.log`,
      `${artifact}.device.log`, `${artifact}.posthoc.log`, `${artifact}.classic.log.source.json`]) {
      if (existsSync(path)) console.error(`${path} (last 16 KiB):\n${readFileSync(path, "utf8").slice(-16384)}`);
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
