import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { iosHostLogArguments, startNativeLog } from "./native-logs.mjs";

export function shutdownEvidence(log, udid) {
  return log.split(/\r?\n/).filter(line => line.toLowerCase().includes(udid.toLowerCase())
    && /\bshut(?:ting)?[ -]?down/i.test(line));
}

export async function waitForLogEvidence(path, matches, signal) {
  signal.throwIfAborted();
  await new Promise((accept, reject) => {
    let watcher;
    const finish = error => {
      watcher?.close();
      signal.removeEventListener("abort", aborted);
      if (error) reject(error); else accept();
    };
    const inspect = () => {
      try { if (matches(readFileSync(path, "utf8"))) finish(); }
      catch (error) { finish(error); }
    };
    const aborted = () => finish(signal.reason);
    watcher = watch(path, inspect);
    watcher.once("error", finish);
    signal.addEventListener("abort", aborted, { once: true });
    inspect();
  });
}

// Called only after PR/queue tests and coverage finish. That job's simulator
// is no longer needed, and those events never publish a simulator-state cache.
// A real shutdown checks the host predicate, not just its argument spelling.
export async function verifyIosHostLog({ udid, artifact,
  execute = promisify(execFile), stream = startNativeLog, wait = waitForLogEvidence }) {
  assert.match(udid, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  const deadline = AbortSignal.timeout(45000);
  const device = async () => {
    const { stdout } = await execute("xcrun", ["simctl", "list", "devices", "--json"],
      { timeout: 5000, signal: deadline });
    return Object.values(JSON.parse(stdout).devices).flat().find(item => item.udid === udid);
  };
  assert.equal((await device())?.state, "Booted", "Refuse shutdown without this job's booted simulator.");
  mkdirSync(dirname(artifact), { recursive: true });
  const observer = stream("/usr/bin/log", iosHostLogArguments(), artifact);
  try {
    await wait(artifact, log => /Filtering the log data using/.test(log),
      AbortSignal.any([deadline, AbortSignal.timeout(5000)]));
    await execute("xcrun", ["simctl", "shutdown", udid], { timeout: 30000, signal: deadline });
    assert.equal((await device())?.state, "Shutdown");
    await wait(artifact, log => shutdownEvidence(log, udid).length > 0,
      AbortSignal.any([deadline, AbortSignal.timeout(5000)]));
    return { udid, shutdownVerified: true,
      correlatedLines: shutdownEvidence(readFileSync(artifact, "utf8"), udid).length };
  } finally { await observer.stop(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert(["pull_request", "merge_group"].includes(process.env.GITHUB_EVENT_NAME));
  assert.equal(process.env.MOBILE_PLATFORM, "iOS");
  assert(process.env.MOBILE_E2E_ARTIFACTS);
  console.log(JSON.stringify(await verifyIosHostLog({ udid: process.env.MOBILE_UDID,
    artifact: resolve(process.env.MOBILE_E2E_ARTIFACTS, "simulator-host-shutdown-contract.log") })));
}
