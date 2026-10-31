import { execFile } from "node:child_process";
import { mkdirSync, openSync, closeSync, readSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const PACKAGE = "com.tanah.daily929";
const MAX_OUTPUT = 1024 * 1024;
const MAX_LIVE_LOG = 32 * MAX_OUTPUT;
const processName = (value) => value === PACKAGE || value?.startsWith(`${PACKAGE}:`);

function readLiveLog(artifacts) {
  const path = resolve(artifacts, "device-live.log");
  const size = statSync(path).size;
  const start = Math.max(0, size - MAX_LIVE_LOG);
  const descriptor = openSync(path, "r");
  try {
    const bytes = Buffer.alloc(Math.min(size, MAX_LIVE_LOG));
    const length = readSync(descriptor, bytes, 0, bytes.length, start);
    const text = bytes.subarray(0, length).toString("utf8");
    return start ? text.slice(text.indexOf("\n") + 1) : text;
  } finally { closeSync(descriptor); }
}

function timestamp(value, reference, offset) {
  if (!value) return NaN;
  const match = value.match(/(?:\d{4}-)?\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (!match) return NaN;
  const text = match[0].replace(" ", "T");
  const year = new Date(reference).getUTCFullYear();
  const candidates = /^\d{4}-/.test(text) ? [text] : [year - 1, year, year + 1].map(y => `${y}-${text}`);
  return candidates.map(candidate => Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(candidate)
    ? candidate : `${candidate}${offset}`))
    .sort((a, b) => Math.abs(a - reference) - Math.abs(b - reference))[0];
}

function launches(log, runStarted, ended, offset) {
  const events = [];
  for (const line of log.split("\n")) {
    const time = timestamp(line, runStarted, offset);
    if (!Number.isFinite(time) || time < runStarted || time > ended) continue;
    const start = line.match(/Start proc (\d+):([^/\s]+)/);
    const death = line.match(/Zygote\s*:\s*Process (\d+) exited/);
    if (start) events.push({ time, pid: Number(start[1]), name: start[2] });
    else if (death) events.push({ time, pid: Number(death[1]) });
  }
  const active = new Map();
  const intervals = [];
  for (const event of events.sort((a, b) => a.time - b.time)) {
    const previous = active.get(event.pid);
    if (!event.name) {
      if (previous) previous.died = event.time;
      continue;
    }
    if (previous) { previous.ended = event.time; previous.reused = true; }
    active.delete(event.pid);
    if (event.name && processName(event.name)) {
      const interval = { pid: event.pid, name: event.name, started: event.time, ended };
      intervals.push(interval);
      active.set(event.pid, interval);
    }
  }
  return intervals;
}

// Crash reports can be persisted after Zygote reports death. Their timestamp
// must precede the next observed owner of this PID, rather than an arbitrary
// grace period after death.
function during(interval, time) {
  return time >= interval.started && (interval.reused ? time < interval.ended : time <= interval.ended);
}

function scoped(text, intervals, runStarted, offset, fallbackTime) {
  const name = text.match(/(?:process=|Process:\s*|Cmdline:\s*|>>>\s*)([\w.:]+)/)?.[1];
  const pid = Number(text.match(/\bpid\s*[:=]\s*(\d+)/i)?.[1]);
  const time = timestamp(text.match(/(?:timestamp=|Timestamp:\s*)([^\n]+)/)?.[1], runStarted, offset)
    || timestamp(fallbackTime, runStarted, offset);
  return processName(name) && intervals.some(interval => interval.pid === pid && interval.name === name
    && during(interval, time));
}

function exitEntries(text, intervals, runStarted, offset) {
  return text.split(/(?=^\s*ApplicationExitInfo [^\n]+:)/m)
    .filter(entry => /^\s*ApplicationExitInfo /.test(entry) && scoped(entry, intervals, runStarted, offset));
}

function dropboxEntries(text, intervals, runStarted, offset) {
  return text.split(/(?=^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[^\n]*\([^\n]*\))/m)
    .filter(entry => /^\d{4}-[^\n]* data_app_native_crash\b/.test(entry)
      && scoped(entry, intervals, runStarted, offset, entry.split("\n")[0]));
}

function crashEntries(text, intervals, runStarted, offset) {
  const groups = [];
  const active = new Map();
  const fatal = [];
  for (const line of text.split("\n")) {
    const signal = line.match(/^(.+?)\s+(\d+)\s+\d+\s+[A-Z]\s+libc\s*:.*Fatal signal/);
    if (signal) {
      const time = timestamp(signal[1], runStarted, offset);
      if (intervals.some(interval => interval.pid === Number(signal[2]) && during(interval, time))) fatal.push(line);
    }
    const match = line.match(/^(.+?)\s+(\d+)\s+\d+\s+[A-Z]\s+DEBUG\s*:\s?(.*)$/);
    if (!match) continue;
    const [, time, logger, content] = match;
    if (content.startsWith("*** *** ***")) {
      const entry = { time, lines: [] };
      groups.push(entry);
      active.set(logger, entry);
    }
    active.get(logger)?.lines.push(line);
  }
  return [...fatal, ...groups.filter(group => scoped(group.lines.join("\n"), intervals, runStarted, offset, group.time))
    .map(group => group.lines.join("\n"))];
}

// Called only after a failed pilot. No device mutation, debugger attachment or
// root restart: missing/denied reports remain explicit diagnostic evidence.
export async function collectAndroidCrashDiagnostics({
  adb, udid, artifacts, runStarted, timeoutMs = 15000, execute = promisify(execFile), now = Date.now,
}) {
  const started = now();
  const monotonicStarted = performance.now();
  const duration = Math.max(0, Math.min(15000, Number(timeoutMs) || 0));
  const summary = { status: "partial", package: PACKAGE, pids: [], files: [], commands: [], errors: [] };
  if (!/^emulator-\d+$/.test(udid ?? "") || typeof artifacts !== "string" || !artifacts
    || !Number.isFinite(runStarted) || runStarted > started) {
    summary.status = "refused";
    summary.errors.push("Requires an explicit emulator serial, artifact directory and valid run start.");
    return summary;
  }
  const destination = resolve(artifacts, "android-crash-diagnostics");
  const save = (name, text) => {
    try {
      mkdirSync(destination, { recursive: true });
      writeFileSync(resolve(destination, name), text);
      summary.files.push(name);
    } catch (error) { summary.errors.push(`Cannot save ${name}: ${error.message}`); }
  };
  async function command(name, args) {
    const elapsed = Math.max(now() - started, performance.now() - monotonicStarted);
    const budget = Math.floor(Math.min(5000, duration - elapsed));
    if (budget <= 0) {
      summary.errors.push(`${name}: diagnostic deadline reached.`);
      return "";
    }
    let timer;
    try {
      const result = await Promise.race([
        execute(adb, ["-s", udid, ...args], { timeout: budget, maxBuffer: MAX_OUTPUT, encoding: "utf8", windowsHide: true }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("diagnostic command timed out")), budget);
        }),
      ]);
      const stdout = String(result.stdout ?? "").slice(0, MAX_OUTPUT);
      const stderr = String(result.stderr ?? "").slice(0, 2000);
      summary.commands.push({ name, status: "complete", timeoutMs: budget });
      if (stderr) summary.errors.push(`${name}: ${stderr}`);
      return stdout;
    } catch (error) {
      summary.commands.push({ name, status: "failed", timeoutMs: budget });
      summary.errors.push(`${name}: ${String(error.stderr || error.message).slice(0, 2000)}`);
      if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || /maxBuffer/i.test(error.message)) {
        summary.errors.push(`${name}: output overflow; retained partial output may omit newer crash reports.`);
      }
      return String(error.stdout ?? "").slice(0, MAX_OUTPUT);
    } finally { clearTimeout(timer); }
  }
  try {
    const zone = (await command("device-timezone", ["shell", "date", "+%z"])).trim();
    if (!/^[+-]\d{4}$/.test(zone)) throw new Error("Device timezone unavailable; cannot safely scope report timestamps.");
    const intervals = launches(readLiveLog(artifacts), runStarted, now(), zone);
    summary.pids = [...new Set(intervals.map(interval => interval.pid))];
    if (!intervals.length) throw new Error("No package launch since run start in device-live.log; historical reports were not collected.");
    const results = await Promise.all([
      command("exit-info", ["shell", "dumpsys", "activity", "exit-info", PACKAGE]),
      command("crash-buffer", ["logcat", "-b", "crash", "-d", "-v", "threadtime"]),
      command("dropbox", ["shell", "dumpsys", "dropbox", "--print", "data_app_native_crash"]),
      command("tombstone-directory", ["shell", "ls", "-ld", "/data/tombstones"]),
    ]);
    const entries = [exitEntries(results[0], intervals, runStarted, zone),
      crashEntries(results[1], intervals, runStarted, zone), dropboxEntries(results[2], intervals, runStarted, zone)];
    for (const [index, name] of ["exit-info.txt", "crash-buffer.txt", "dropbox-native-crash.txt"].entries()) {
      save(name, entries[index].join("\n\n") || "No matching package/PID/time report was available.\n");
    }
    // Directory metadata contains no other app's report contents. Read only a
    // text tombstone path explicitly named by a matching current-run report.
    save("tombstone-directory.txt", results[3] || "Directory metadata unavailable; see summary errors.\n");
    const paths = [...new Set(entries.flat().join("\n").match(/\/data\/tombstones\/tombstone_\d{2}\b(?!\.pb)/g) ?? [])].slice(0, 2);
    for (const path of paths) {
      const text = await command(`tombstone-${path.slice(-2)}`, ["shell", "cat", path]);
      if (scoped(text, intervals, runStarted, zone)) save(`tombstone-${path.slice(-2)}.txt`, text);
      else summary.errors.push(`${path}: unavailable or no longer matches this run's package/PID/time.`);
    }
    if (!entries[1].some(text => text.includes("backtrace:"))
      && !entries[2].some(text => text.includes("backtrace:")) && !summary.files.some(name => /^tombstone-\d/.test(name))) {
      summary.errors.push("No scoped native stack was available; no crashing library can be identified from these diagnostics.");
    }
  } catch (error) { summary.errors.push(String(error.message)); }
  summary.elapsedMs = Math.max(0, now() - started);
  summary.status = summary.errors.length ? "partial" : "complete";
  save("summary.json", `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
