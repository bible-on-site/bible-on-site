import { execFile } from "node:child_process";
import { posix } from "node:path";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const bundleId = "com.tanah.daily929";
const cleanupDeadlineMs = 5000;
const defaultDevicesRoot = posix.join(homedir(), "Library/Developer/CoreSimulator/Devices");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ownedIosTestAppProcesses(listing, udid, devicesRoot = defaultDevicesRoot) {
  if (typeof udid !== "string" || udid.length !== 36 || !uuid.test(udid)) {
    throw new Error("Simulator app cleanup requires this run's explicit UDID.");
  }
  const devicePath = `${posix.join(devicesRoot, udid, "data/Containers/Bundle/Application")}/`;
  const records = [];
  for (const line of listing.split("\n")) {
    const fields = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!fields) continue;
    const [, pid, state, executable] = fields;
    if (executable === "BibleOnSite" || executable === "(BibleOnSite)") {
      throw new Error("Cannot establish simulator ownership of an unqualified BibleOnSite process.");
    }
    if (!executable.startsWith(devicePath) || !executable.endsWith("/BibleOnSite.app/BibleOnSite")) continue;
    const relative = executable.slice(devicePath.length).split("/");
    if (posix.normalize(executable) !== executable || !executable.startsWith("/") ||
        relative.length !== 3 || relative[0].length !== 36 || !uuid.test(relative[0])) {
      throw new Error("Invalid executable path for this simulator's BibleOnSite process.");
    }
    const processId = Number(pid);
    if (!Number.isSafeInteger(processId) || processId <= 1) throw new Error("Invalid iOS app process identity.");
    records.push({ pid: processId, state, executable });
  }
  return records;
}

export async function terminateIosTestApp(udid, {
  keepApp = false, execute = executeFile, signal = (pid, value) => process.kill(pid, value),
  sleep = delay, now = Date.now, devicesRoot = defaultDevicesRoot, observedPids = [],
} = {}) {
  // Validate ownership even when keeping an app for local review.
  ownedIosTestAppProcesses("", udid, devicesRoot);
  const started = now();
  if (keepApp) return { status: "kept", udid, bundleId, elapsedMs: 0 };
  const list = async () => {
    const remaining = cleanupDeadlineMs - (now() - started);
    if (remaining <= 0) throw new Error("The owned iOS app did not exit within five seconds.");
    const candidates = typeof observedPids === "function" ? observedPids() : observedPids;
    if (!Array.isArray(candidates) || !candidates.length ||
        candidates.some(pid => !Number.isSafeInteger(pid) || pid <= 1)) {
      throw new Error("Require app PIDs observed in this simulator's live log.");
    }
    // Broad ps snapshots inspect Mach tasks for every host process, even
    // with few output columns. Restrict inspection to this device's observed
    // app PIDs, then verify their complete installed executable paths.
    let stdout, stderr;
    try {
      ({ stdout, stderr = "" } = await execute("/bin/ps", ["-p", [...new Set(candidates)].join(","),
        "-ww", "-o", "pid=,stat=,comm="], { timeout: remaining, windowsHide: true }));
    } catch (error) {
      // Header-free ps exits 1 with no output only when all selected PIDs
      // have exited. Timeouts and diagnostic/permission errors remain fatal.
      if (error.code !== 1 || error.killed || typeof error.stdout !== "string" ||
          typeof error.stderr !== "string" || error.stdout.trim() || error.stderr.trim()) throw error;
      stdout = "";
      stderr = "";
    }
    if (stderr.trim()) throw new Error(`App process inspection failed: ${stderr.trim()}`);
    if (now() - started >= cleanupDeadlineMs) throw new Error("The owned iOS app did not exit within five seconds.");
    return ownedIosTestAppProcesses(stdout, udid, devicesRoot).filter(record => !record.state.startsWith("Z"));
  };
  const owned = await list();
  // Tests have exported coverage and failure captures before this cleanup.
  // End only this device's installed app, without blocking on CoreSimulator
  // IPC or XCTest app-state queries. No shutdown persistence is required.
  for (const { pid } of owned) {
    try { signal(pid, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  while (now() - started < cleanupDeadlineMs) {
    if (!(await list()).length) {
      return { status: owned.length ? "terminated" : "already-stopped", udid, bundleId,
        pids: owned.map(({ pid }) => pid), elapsedMs: now() - started };
    }
    await sleep(Math.min(50, cleanupDeadlineMs - (now() - started)));
  }
  throw new Error("The owned iOS app did not exit within five seconds.");
}
