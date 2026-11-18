// Read-only bootstrap evidence. No simctl call, device reset, cache mutation,
// or retry is performed here: a stalled CoreSimulator must remain observable.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  readdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, release } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { iosHostLogArguments, startIosClassicHostLog, startNativeLog,
  stopNativeLogStreams } from "./native-logs.mjs";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const STAGES = new Set(["before-cache", "before-boot", "wait-start", "wait-ready", "wait-failed"]);
const PLIST_LIMIT = 1024 * 1024;
const TAIL_LIMIT = 64 * 1024;

function ownedDirectory(home, udid) {
  if (!UUID.test(udid ?? "")) throw new Error("Bootstrap evidence requires an explicit simulator UUID.");
  const devices = join(home, "Library", "Developer", "CoreSimulator", "Devices");
  const directory = join(devices, udid);
  // An absent device is useful before restore. Existing paths must resolve to
  // this UUID immediately under the real Devices root, never a linked peer.
  if (existsSync(directory)) {
    const canonical = realpathSync(directory);
    if (lstatSync(directory).isSymbolicLink() || dirname(canonical) !== realpathSync(devices)
      || basename(canonical).toLowerCase() !== udid.toLowerCase()) {
      throw new Error("Refuse bootstrap evidence outside the owned simulator directory.");
    }
  }
  return directory;
}

function details(path) {
  try {
    const stat = lstatSync(path);
    return { type: stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
      bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
  } catch (error) { return { error: error.code ?? error.message }; }
}

export function snapshotIosBoot({ udid, stage, artifacts, home = homedir(), env = process.env }) {
  if (!STAGES.has(stage)) throw new Error("Invalid bootstrap evidence stage.");
  const directory = ownedDirectory(home, udid);
  const destination = join(resolve(artifacts), "ios-boot-observation");
  mkdirSync(destination, { recursive: true });
  const result = { udid, stage, at: new Date().toISOString(), hostRelease: release(),
    developerDir: env.DEVELOPER_DIR ?? null, cacheHit: env.IOS_SIM_CACHE_HIT ?? null,
    source: directory, entries: {}, files: [] };
  try {
    const entries = readdirSync(directory).sort();
    result.entryCount = entries.length;
    for (const name of entries.slice(0, 128)) result.entries[name] = details(join(directory, name));
    result.entriesTruncated = entries.length > 128;
  } catch (error) { result.directoryError = error.code ?? error.message; }
  const plist = join(directory, "device.plist");
  const metadata = details(plist);
  result.plist = metadata;
  if (metadata.type === "file" && metadata.bytes <= PLIST_LIMIT) {
    const bytes = readFileSync(plist);
    result.plist = { ...metadata, sha256: createHash("sha256").update(bytes).digest("hex") };
    writeFileSync(join(destination, `${stage}.device.plist`), bytes);
  }
  // Enumerate names and metadata, never lock contents, and never traverse a
  // linked data volume. This distinguishes stale lock/session entries without
  // copying application data or recursively walking a potentially bad cache.
  const data = join(directory, "data");
  if (details(data).type === "directory" && realpathSync(data) === join(realpathSync(directory), "data")) {
    const run = join(data, "var", "run");
    try {
      const canonical = realpathSync(run);
      if (relative(realpathSync(data), canonical).startsWith("..")) throw new Error("run directory escapes owned data");
      const names = readdirSync(run).sort();
      result.runEntryCount = names.length;
      result.runEntriesTruncated = names.length > 128;
      for (const name of names.slice(0, 128)) result.files.push({ path: `data/var/run/${name}`, ...details(join(run, name)) });
    } catch (error) { result.runDirectoryError = error.code ?? error.message; }
  }
  writeFileSync(join(destination, `${stage}.json`), JSON.stringify(result, null, 2));
  return result;
}

function copyDeviceLogTail(home, udid, destination) {
  const source = join(home, "Library", "Logs", "CoreSimulator", udid, "system.log");
  const stat = details(source);
  if (stat.type !== "file") return { source, ...stat };
  const descriptor = openSync(source, "r");
  try {
    const offset = Math.max(0, stat.bytes - TAIL_LIMIT);
    const bytes = Buffer.alloc(Math.min(stat.bytes, TAIL_LIMIT));
    const read = readSync(descriptor, bytes, 0, bytes.length, offset);
    writeFileSync(destination, bytes.subarray(0, read));
    return { source, offset, bytes: read };
  } finally { closeSync(descriptor); }
}

export function startIosBootObservation({ udid, artifacts, home = homedir(), env = process.env,
  execute = promisify(execFile), stream = startNativeLog, classic = startIosClassicHostLog,
  report = console.log }) {
  ownedDirectory(home, udid);
  const destination = join(resolve(artifacts), "ios-boot-observation");
  mkdirSync(destination, { recursive: true });
  const readers = [];
  const errors = [];
  const recordError = error => { errors.push(String(error)); report(`Bootstrap evidence: ${error.message ?? error}`); };
  try { readers.push(stream("/usr/bin/log", iosHostLogArguments(), join(destination, "host.log"))); }
  catch (error) { recordError(error); }
  try { readers.push(classic(join(destination, "host.classic.log"), { home, start: stream })); }
  catch (error) { recordError(error); }
  const controller = new AbortController();
  // This read runs beside bootstatus, is bounded independently, and never
  // asks the stuck service for another device listing. No process arguments
  // or environment (which could contain secrets) are retained.
  const processes = execute("/bin/ps", ["-axo", "pid=,ppid=,stat=,etime=,comm="],
    { encoding: "utf8", timeout: 1000, maxBuffer: 1024 * 1024, signal: controller.signal })
    .then(({ stdout }) => writeFileSync(join(destination, "host-processes.log"), stdout.split("\n")
      .filter(line => /(?:CoreSimulatorService|simulatord|SimLaunchHost|launchd_sim|simctl)(?:\s|$)/.test(line)).join("\n")))
    .catch(recordError);
  return {
    snapshot(stage) {
      try { snapshotIosBoot({ udid, stage, artifacts, home, env }); }
      catch (error) { recordError(error); }
    },
    async stop() {
      controller.abort();
      const joined = await Promise.allSettled([processes, stopNativeLogStreams(readers)]);
      for (const result of joined) if (result.status === "rejected") recordError(result.reason);
      let deviceLog;
      try { deviceLog = copyDeviceLogTail(home, udid, join(destination, "device.tail.log")); }
      catch (error) { recordError(error); }
      writeFileSync(join(destination, "collection.json"), JSON.stringify({ udid, errors, deviceLog }, null, 2));
    },
  };
}
