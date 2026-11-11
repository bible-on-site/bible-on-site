import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { iosHostLogArguments, startNativeLog } from "./native-logs.mjs";

const lifecycleEmitters = new Set(["CoreSimulatorService",
  "com.apple.CoreSimulator.CoreSimulatorService", "DeviceHub", "simulatord", "launchd_sim"]);

export function shutdownEvidence(log, udid) {
  return log.split(/\r?\n/).filter(line => {
    // Parse the compact record's emitter, rather than matching a service name
    // quoted in its payload. Requester logs remain useful context, not proof.
    const emitter = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+\S+\s+([A-Za-z_.]+)\[\d+(?::[a-f0-9]+)?\]/.exec(line)?.[1];
    return lifecycleEmitters.has(emitter) && line.toLowerCase().includes(udid.toLowerCase())
      && /\bshut(?:ting)?[ -]?down/i.test(line);
  });
}

// Consume the logger's pipe directly. macOS file watcher registration can
// miss an immediate write; a pipe buffers that output until its reader runs.
export function observeIosHostLog(udid) {
  const listeners = new Set();
  let partial = "", startup = false, shutdown = false;
  return {
    write(chunk) {
      const lines = (partial + chunk.toString()).split(/\r?\n/);
      partial = lines.pop();
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
// A real shutdown checks the host predicate, not just its argument spelling.
export async function verifyIosHostLog({ udid, artifact,
  execute = promisify(execFile), stream = startNativeLog, observe = observeIosHostLog,
  report = () => {} }) {
  assert.match(udid, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  // Reserve the existing five-second observer stop cap inside the 45s check.
  const deadline = AbortSignal.timeout(40000);
  const device = async () => {
    const { stdout } = await execute("xcrun", ["simctl", "list", "devices", "--json"],
      { timeout: 5000, signal: deadline });
    return Object.values(JSON.parse(stdout).devices).flat().find(item => item.udid === udid);
  };
  assert.equal((await device())?.state, "Booted", "Refuse shutdown without this job's booted simulator.");
  mkdirSync(dirname(artifact), { recursive: true });
  const evidence = observe(udid);
  const observer = stream("/usr/bin/log", iosHostLogArguments(), artifact,
    { onOutput: chunk => evidence.write(chunk) });
  let stage;
  const enter = name => {
    stage = name;
    report({ udid, stage, at: new Date().toISOString() });
  };
  try {
    enter("host logger startup");
    await evidence.waitFor("startup",
      AbortSignal.any([deadline, AbortSignal.timeout(5000)]));
    enter("owned simulator shutdown command");
    await execute("xcrun", ["simctl", "shutdown", udid], { timeout: 30000, signal: deadline });
    enter("shutdown state verification");
    assert.equal((await device())?.state, "Shutdown");
    enter("device-correlated host shutdown event");
    await evidence.waitFor("shutdown",
      AbortSignal.any([deadline, AbortSignal.timeout(5000)]));
    return { udid, shutdownVerified: true,
      correlatedLines: shutdownEvidence(readFileSync(artifact, "utf8"), udid).length };
  } catch (cause) {
    throw new Error(`iOS host log verification failed during ${stage}: ${cause.message}`, { cause });
  } finally { await observer.stop(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert(["pull_request", "merge_group"].includes(process.env.GITHUB_EVENT_NAME));
  assert.equal(process.env.MOBILE_PLATFORM, "iOS");
  assert(process.env.MOBILE_E2E_ARTIFACTS);
  const artifact = resolve(process.env.MOBILE_E2E_ARTIFACTS, "simulator-host-shutdown-contract.log");
  try {
    console.log(JSON.stringify(await verifyIosHostLog({ udid: process.env.MOBILE_UDID,
      artifact, report: event => console.log(JSON.stringify(event)) })));
  } catch (error) {
    // Keep the short controlled capture visible even if artifact storage fails.
    if (existsSync(artifact)) console.error(`Host shutdown capture (last 16 KiB):\n${readFileSync(artifact, "utf8").slice(-16384)}`);
    throw error;
  }
}
