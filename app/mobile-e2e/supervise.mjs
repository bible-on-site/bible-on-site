import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mergeShardAppCoverage, mergeShardEvidence } from "./shards.mjs";

export const PILOT_TIMEOUT_MS = 15 * 60 * 1000;

// The supervisor runs outside the harness process group. Its clock continues
// even when a native export or synchronous build blocks the harness's event loop.
export function supervise(command, args, {
  timeoutMs = PILOT_TIMEOUT_MS, graceMs = 3000, cwd, env = process.env,
  stdio = "inherit", onDeadline = () => {},
} = {}) {
  const child = spawn(command, args, {
    cwd, env, stdio, windowsHide: true, detached: process.platform !== "win32",
  });
  let timer;
  let escalation;
  let stopping = false;
  let finished = false;
  let complete;
  const result = new Promise(resolveResult => { complete = resolveResult; });
  const finish = code => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    clearTimeout(escalation);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    complete(code);
  };
  const signalGroup = signal => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") {
        // Kill the tree before its parent can exit and orphan grandchildren.
        execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore", timeout: 2000 });
      } else {
        process.kill(-child.pid, signal);
      }
    } catch (error) {
      if (error.code !== "ESRCH") console.error("Could not stop the mobile process group:", error);
    }
  };
  const stop = (code = 143) => {
    if (stopping || finished) return;
    stopping = true;
    signalGroup("SIGTERM");
    // Escalate even when the immediate child exits: its Appium/dotnet/native
    // grandchildren can ignore TERM and keep running after their parent dies.
    escalation = setTimeout(() => {
      if (process.platform !== "win32") signalGroup("SIGKILL");
      finish(code);
    }, graceMs);
  };
  const interrupt = () => stop(130);
  const terminate = () => stop(143);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  child.once("error", error => { console.error("Could not start mobile tests:", error); finish(1); });
  child.once("exit", code => {
    if (!stopping) {
      if (process.platform !== "win32") signalGroup("SIGKILL");
      finish(code ?? 1);
    }
  });
  timer = setTimeout(() => {
    console.error(`Mobile pilot exceeded its ${timeoutMs / 60000}-minute wall-clock deadline.`);
    try { onDeadline(); }
    catch (error) { console.error("Could not save mobile deadline evidence:", error); }
    finally { stop(124); }
  }, timeoutMs);
  return { child, result, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const entry = process.argv[2];
  if (!["run.mjs", "run-sharded.mjs"].includes(entry)) throw new Error("Choose run.mjs or run-sharded.mjs.");
  const directory = dirname(fileURLToPath(import.meta.url));
  const artifacts = process.env.MOBILE_E2E_ARTIFACTS ?? resolve(directory,
    "../.artifacts/mobile-e2e", process.env.MOBILE_PLATFORM?.toLowerCase() ?? "unknown");
  mkdirSync(artifacts, { recursive: true });
  const started = Date.now();
  const timingPath = resolve(artifacts, "pilot-timing.json");
  const save = extra => writeFileSync(timingPath, JSON.stringify({
    startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started,
    deadlineMs: PILOT_TIMEOUT_MS, ...extra,
  }, null, 2));
  save({ status: "running" });
  const run = supervise(process.execPath, [resolve(directory, entry)], {
    cwd: directory, onDeadline: () => save({ status: "timed-out" }),
  });
  process.exitCode = await run.result;
  if (entry === "run-sharded.mjs" && [124, 130, 143].includes(process.exitCode)) {
    // The killed coordinator cannot perform its merge. Preserve partial
    // per-test evidence and app dumps for the normal CI collection steps.
    const sources = [resolve(artifacts, "shard1"), resolve(artifacts, "shard2")];
    mergeShardEvidence(sources, resolve(artifacts, "coverage-evidence"));
    mergeShardAppCoverage(sources, resolve(artifacts, "app-coverage"));
  }
  save({ status: process.exitCode === 124 ? "timed-out" : "completed", exitCode: process.exitCode });
  console.log(`Mobile pilot finished in ${Math.round((Date.now() - started) / 1000)}s (exit ${process.exitCode}).`);
}
