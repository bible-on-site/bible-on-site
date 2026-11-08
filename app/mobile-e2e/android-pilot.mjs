import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const cleanupDeadlineMs = 5000;

export async function linuxProcesses() {
  const records = [];
  for (const name of await readdir("/proc")) {
    if (!name || !Array.from(name).every(character => "0123456789".includes(character))) continue;
    try {
      const args = (await readFile(`/proc/${name}/cmdline`, "utf8")).split("\0").filter(Boolean);
      if (!args.length) continue;
      const stat = await readFile(`/proc/${name}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      records.push({ pid: Number(name), ppid: Number(fields[1]), state: fields[0], args });
    } catch (error) {
      // Processes may exit between enumerating /proc and opening their files.
      if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
    }
  }
  return records;
}

export function ownedTestEmulatorProcesses(records, avdName, udid) {
  const port = udid?.startsWith("emulator-") ? udid.slice("emulator-".length) : "";
  if (!avdName || !port || !Array.from(port).every(character => "0123456789".includes(character))) {
    throw new Error("Require the explicit test AVD name and emulator serial.");
  }
  const roots = records.filter(({ args }) => {
    const executable = basename(args[0]);
    return (executable === "emulator" || executable.startsWith("qemu-system-")) &&
      args[args.indexOf("-avd") + 1] === avdName && args.includes("-avd") &&
      args[args.indexOf("-port") + 1] === port && args.includes("-port");
  });
  if (roots.some(({ args }) => !args.includes("-no-snapshot-save"))) {
    throw new Error("Refuse to terminate a snapshot-producing emulator.");
  }
  const owned = new Set(roots.map(({ pid }) => pid));
  let added;
  do {
    added = false;
    for (const record of records) {
      if (owned.has(record.ppid) && !owned.has(record.pid)) {
        owned.add(record.pid);
        added = true;
      }
    }
  } while (added);
  return records.filter(({ pid }) => owned.has(pid));
}

export async function terminateAndroidTestEmulator({
  avdName, udid, list = linuxProcesses, signal = (pid, value) => process.kill(pid, value),
  sleep = delay, now = Date.now,
}) {
  const started = now();
  const owned = ownedTestEmulatorProcesses(await list(), avdName, udid);
  // This pilot uses -no-snapshot-save. Coverage and logs are already exported;
  // no shutdown snapshot needs flushing. End its QEMU tree directly instead
  // of leaving the action's inherited output pipes open after `emu kill` ACKs.
  for (const record of owned) {
    if (record.pid <= 1) throw new Error("Invalid emulator process identity.");
    try { signal(record.pid, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  while (now() - started < cleanupDeadlineMs) {
    const remaining = (await list()).filter(record => owned.some(original =>
      original.pid === record.pid && original.args.join("\0") === record.args.join("\0")) &&
      !["Z", "X"].includes(record.state));
    if (!remaining.length) {
      return { status: owned.length ? "terminated" : "already-stopped", avdName, udid,
        pids: owned.map(({ pid }) => pid), elapsedMs: now() - started };
    }
    await sleep(50);
  }
  throw new Error("The owned Android emulator did not exit within five seconds.");
}

function runPilot() {
  const child = spawn(process.execPath, [resolve(directory, "supervise.mjs"), "run.mjs"], {
    cwd: directory, stdio: "inherit", windowsHide: true,
  });
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  return new Promise((complete, reject) => {
    const unbind = () => { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); };
    child.once("error", error => { unbind(); reject(error); });
    child.once("exit", code => { unbind(); complete(code ?? 1); });
  });
}

export async function runAndroidPilot({ run = runPilot, cleanup, record = () => {} }) {
  let exitCode = 1;
  try { exitCode = await run(); }
  finally {
    try { record(await cleanup()); }
    catch (error) {
      record({ status: "failed", error: String(error) });
      console.error("Android emulator cleanup failed:", error);
      exitCode ||= 1;
    }
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== "linux") throw new Error("The disposable Android CI pilot requires Linux.");
  const artifacts = process.env.MOBILE_E2E_ARTIFACTS ?? resolve(directory, "../.artifacts/mobile-e2e/android");
  mkdirSync(artifacts, { recursive: true });
  process.exitCode = await runAndroidPilot({
    cleanup: () => terminateAndroidTestEmulator({ avdName: process.env.AVD_NAME, udid: process.env.MOBILE_UDID }),
    record: result => {
      writeFileSync(resolve(artifacts, "android-emulator-cleanup.json"), `${JSON.stringify(result, null, 2)}\n`);
      console.log(`Android emulator cleanup: ${JSON.stringify(result)}`);
    },
  });
}
