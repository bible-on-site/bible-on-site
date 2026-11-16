import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// This parent owns one POSIX process group, including the fixed installer's
// native children. Cancellation never enumerates or stops unrelated processes.
export async function executeOwnedIosInstaller({ appPath, udid, nonce, keepData, deadlineMs,
  environment, signal, report = () => {}, launch = spawn,
  signalGroup = pid => process.kill(-pid, "SIGKILL"),
}) {
  signal.throwIfAborted();
  if (process.platform === "win32") throw new Error("Owned iOS installer groups require a POSIX host.");
  if (!isAbsolute(appPath) || !uuid.test(udid ?? "") || !/^[0-9a-f]{32}$/i.test(nonce ?? "") ||
      typeof keepData !== "boolean" || !Number.isFinite(deadlineMs) ||
      deadlineMs <= Date.now() || deadlineMs - Date.now() > 300000) {
    throw new Error("Invalid fixed iOS installer identity or original deadline.");
  }
  const started = performance.now();
  const args = [fileURLToPath(new URL("./ios-install.mjs", import.meta.url)), appPath, udid, nonce,
    keepData ? "keep" : "reset", String(deadlineMs), process.execPath];
  signal.throwIfAborted();
  if (Date.now() >= deadlineMs) throw new Error("The original iOS deadline expired before installer launch.");
  const child = launch(process.execPath, args, {
    env: environment, detached: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let primary, cleanupFailure, failUncertain, signalled = false, finished = false, settled = false, bytes = 0;
  const stdout = [], stderr = [];
  const record = value => {
    try { report({ ...value, processId: child.pid ?? null, nonce, udid, elapsedMs: performance.now() - started }); }
    catch (error) { primary ??= error; }
  };
  const stopGroup = () => {
    if (signalled || !child.pid) return;
    signalled = true;
    record({ phase: "group-kill-starting" });
    try { signalGroup(child.pid); }
    catch (error) {
      if (error.code !== "ESRCH") cleanupFailure ??= error;
    }
    record({ phase: "group-kill-returned", cleanupUncertain: Boolean(cleanupFailure) });
    if (cleanupFailure) failUncertain();
  };
  const cancelled = () => {
    if (finished) return;
    primary ??= signal.reason ?? new Error("iOS installation cancelled.");
    record({ phase: "cancellation-observed" });
    stopGroup();
  };
  const retain = (target, chunk) => {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) {
      primary ??= new Error("iOS installer output exceeded its bounded capture.");
      stopGroup();
    } else target.push(chunk);
  };
  const completed = new Promise((resolve, reject) => {
    const rejectFailure = joined => {
      if (settled) return;
      settled = true;
      const failure = primary && cleanupFailure
        ? new AggregateError([primary, cleanupFailure], "iOS installation failed and process-group cleanup is uncertain.")
        : primary ?? cleanupFailure;
      reject(Object.assign(failure, { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"),
        cleanupUncertain: Boolean(cleanupFailure), processGroupId: child.pid, joined }));
    };
    failUncertain = () => {
      // A denied signal cannot be made into a join. Fail immediately and
      // retain the exact unresolved owner; do not wait on its held-open pipes
      // or keep the already failed runner alive after its original deadline.
      record({ phase: "installer-cleanup-uncertain", joined: false, signalCode: cleanupFailure.code ?? null });
      signal.removeEventListener("abort", cancelled);
      rejectFailure(false);
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    };
    child.stdout.on("error", error => { primary ??= error; stopGroup(); });
    child.stderr.on("error", error => { primary ??= error; stopGroup(); });
    child.stdout.on("data", chunk => retain(stdout, chunk));
    child.stderr.on("data", chunk => retain(stderr, chunk));
    child.once("error", error => { primary ??= error; stopGroup(); });
    child.once("exit", (code, exitSignal) => {
      if (!primary && (code !== 0 || exitSignal)) {
        primary = Object.assign(new Error("The fixed iOS installer failed."), { code, signal: exitSignal });
      }
      record({ phase: "installer-exited", code, signal: exitSignal });
      // A helper that exits early must not leave a grandchild holding pipes.
      stopGroup();
    });
    child.once("close", (code, exitSignal) => {
      finished = true;
      signal.removeEventListener("abort", cancelled);
      record({ phase: cleanupFailure ? "installer-channels-closed" : "installer-joined", code, signal: exitSignal });
      if (settled) return;
      if (!primary && (code !== 0 || exitSignal)) {
        primary = Object.assign(new Error("The fixed iOS installer failed."), { code, signal: exitSignal });
      }
      if (primary || cleanupFailure) {
        rejectFailure(true);
      } else { settled = true; resolve(Buffer.concat(stdout).toString("utf8")); }
    });
  });
  signal.addEventListener("abort", cancelled, { once: true });
  record({ phase: "installer-started", command: process.execPath, argv: args });
  if (signal.aborted) cancelled();
  else if (primary) stopGroup();
  return completed;
}
