import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectAndroidCrashDiagnostics } from "./android-crash-diagnostics.mjs";

const PACKAGE = "com.tanah.daily929";
const START = Date.parse("2026-10-28T12:31:52Z");
const END = Date.parse("2026-10-28T12:33:00Z");
const launch = (time, pid, name = PACKAGE) => `10-28 ${time} 667 700 I ActivityManager: Start proc ${pid}:${name}/u0a219 for next-top-activity`;
const died = (time, pid) => `10-28 ${time} 463 463 I Zygote  : Process ${pid} exited due to signal 11 (Segmentation fault)`;
const exit = (time, pid, name = PACKAGE, trace = "null") => `  ApplicationExitInfo #0:
    timestamp=2026-10-28 ${time} pid=${pid} realUid=10219 packageUid=10219 definingUid=10219 user=0
    process=${name} reason=5 (CRASH NATIVE) subreason=0 (UNKNOWN) status=11
    importance=100 pss=10MB rss=20MB description=crash state=empty trace=${trace}
`;
const native = (time, pid, name = PACKAGE, frame = "libmonosgen-2.0.so") => `*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
Timestamp: 2026-10-28 ${time}+0000
Cmdline: ${name}
pid: ${pid}, tid: ${pid}, name: reader  >>> ${name} <<<
signal 11 (SIGSEGV), code 1 (SEGV_MAPERR)
backtrace:
    #00 pc 0000 /data/app/${frame}
`;
const crash = (time, pid, name = PACKAGE, logger = 9000) => native(time, pid, name).trimEnd().split("\n")
  .map(line => `10-28 ${time} ${logger} ${logger} F DEBUG   : ${line}`).join("\n");
const dropbox = (time, pid, name = PACKAGE) => `2026-10-28 ${time} data_app_native_crash (text, 512 bytes)
Process: ${name}
PID: ${pid}
${native(time, pid, name)}`;

async function fixture(run, log = `${launch("12:32:24.269", 4738)}\n${died("12:32:39.733", 4738)}`) {
  const artifacts = mkdtempSync(join(tmpdir(), "android-crash-diagnostics-"));
  writeFileSync(join(artifacts, "device-live.log"), log);
  const read = name => readFileSync(join(artifacts, "android-crash-diagnostics", name), "utf8");
  try { await run({ artifacts, read }); }
  finally { rmSync(artifacts, { recursive: true, force: true }); }
}

function executor(outputs = {}, observe = () => {}) {
  return async (command, args, options) => {
    observe(command, args, options);
    const key = args.slice(2).join(" ");
    const value = outputs[key];
    if (value instanceof Error) throw value;
    return { stdout: value ?? (key === "shell date +%z" ? "+0000\n" : ""), stderr: "" };
  };
}

const collect = (artifacts, execute, extra = {}) => collectAndroidCrashDiagnostics({
  adb: "task-adb", udid: "emulator-5554", artifacts, runStarted: START, now: () => END, execute, ...extra,
});

test("retains current-run native stack and exit record while excluding other packages and historical records", async () => {
  await fixture(async ({ artifacts, read }) => {
    const calls = [];
    const summary = await collect(artifacts, executor({
      [`shell dumpsys activity exit-info ${PACKAGE}`]: exit("12:30:39.733", 4738) + exit("12:32:39.733", 4738) + exit("12:32:39.733", 9999, "other.app"),
      "logcat -b crash -d -v threadtime": `${crash("12:30:39.733", 4738)}\n${crash("12:32:39.733", 4738)}\n${crash("12:32:39.733", 9999, "other.app", 9001)}`,
      "shell dumpsys dropbox --print data_app_native_crash": dropbox("12:30:39.733", 4738) + dropbox("12:32:39.733", 4738) + dropbox("12:32:39.733", 9999, "other.app"),
      "shell ls -ld /data/tombstones": "drwxrwx--x tombstoned system /data/tombstones\n",
    }, (command, args, options) => calls.push({ command, args, options })));
    assert.equal(summary.status, "complete");
    assert.deepEqual(summary.pids, [4738]);
    for (const name of ["exit-info.txt", "crash-buffer.txt", "dropbox-native-crash.txt"]) {
      const text = read(name);
      assert.match(text, /12:32:39\.733/);
      assert.doesNotMatch(text, /12:30:39|other\.app|9999/);
    }
    assert.match(read("crash-buffer.txt"), /backtrace:[\s\S]*libmonosgen-2\.0\.so/);
    for (const call of calls) {
      assert.equal(call.command, "task-adb");
      assert.deepEqual(call.args.slice(0, 2), ["-s", "emulator-5554"]);
      assert.ok(call.options.timeout <= 5000);
      assert.ok(call.options.maxBuffer <= 1024 * 1024);
      assert.doesNotMatch(call.args.join(" "), /\b(root|kill|debuggerd|restart|setprop|clear)\b/);
    }
  });
});

test("delayed reports are retained until PID reuse, with old records and the later owner excluded", async () => {
  await fixture(async ({ artifacts, read }) => {
    await collect(artifacts, executor({
      [`shell dumpsys activity exit-info ${PACKAGE}`]: exit("12:32:20.000", 4738) + exit("12:32:39.733", 4738)
        + exit("12:32:43.000", 4738) + exit("12:32:45.000", 4738) + exit("12:32:50.000", 4738),
      "logcat -b crash -d -v threadtime": crash("12:32:39.733", 4738),
    }));
    assert.match(read("exit-info.txt"), /12:32:39\.733/);
    assert.match(read("exit-info.txt"), /12:32:43\.000/);
    assert.doesNotMatch(read("exit-info.txt"), /12:32:20|12:32:45|12:32:50/);
  }, `${launch("12:30:00.000", 4738)}\n${launch("12:32:24.269", 4738)}\n${died("12:32:39.733", 4738)}\n${launch("12:32:45.000", 4738, "other.app")}`);
});

test("timezone calibration scopes local device timestamps without assuming host timezone", async () => {
  await fixture(async ({ artifacts, read }) => {
    const result = await collect(artifacts, executor({
      "shell date +%z": "+0200",
      [`shell dumpsys activity exit-info ${PACKAGE}`]: exit("14:32:39.733", 4738),
    }));
    assert.deepEqual(result.pids, [4738]);
    assert.match(read("exit-info.txt"), /14:32:39/);
  }, `${launch("14:32:24.269", 4738)}\n${died("14:32:39.733", 4738)}`);
});

test("reads only a safe tombstone path named by a matching report and rejects a replaced historical file", async () => {
  await fixture(async ({ artifacts, read }) => {
    const calls = [];
    const result = await collect(artifacts, executor({
      [`shell dumpsys activity exit-info ${PACKAGE}`]: exit("12:32:39.733", 4738, PACKAGE, "/data/tombstones/tombstone_06"),
      "shell cat /data/tombstones/tombstone_06": native("12:32:39.733", 4738),
    }, (_command, args) => calls.push(args.join(" "))));
    assert.ok(result.files.includes("tombstone-06.txt"));
    assert.match(read("tombstone-06.txt"), /backtrace:/);
    assert.deepEqual(calls.filter(call => call.includes(" cat ")), ["-s emulator-5554 shell cat /data/tombstones/tombstone_06"]);
    const replaced = await collect(artifacts, executor({
      [`shell dumpsys activity exit-info ${PACKAGE}`]: exit("12:32:39.733", 4738, PACKAGE, "/data/tombstones/tombstone_07"),
      "shell cat /data/tombstones/tombstone_07": native("12:30:00.000", 4738),
    }));
    assert.ok(replaced.errors.some(error => error.includes("no longer matches")));
    assert.ok(!replaced.files.includes("tombstone-07.txt"));
  });
});

test("permission failures and partial native output are retained without rejecting", async () => {
  await fixture(async ({ artifacts, read }) => {
    const denied = Object.assign(new Error("adb exited 1"), { stderr: "ls: /data/tombstones: Permission denied" });
    const truncated = Object.assign(new Error("stdout maxBuffer length exceeded"), { stdout: crash("12:32:39.733", 4738) });
    const result = await collect(artifacts, executor({
      "logcat -b crash -d -v threadtime": truncated,
      "shell ls -ld /data/tombstones": denied,
    }));
    assert.equal(result.status, "partial");
    assert.match(read("crash-buffer.txt"), /backtrace:/);
    assert.match(read("summary.json"), /Permission denied|maxBuffer/);
    assert.match(read("summary.json"), /partial output may omit newer crash reports/);
  });
});

test("an unresponsive command is bounded and an exhausted total budget launches no commands", async () => {
  await fixture(async ({ artifacts }) => {
    const started = Date.now();
    const result = await collect(artifacts, () => new Promise(() => {}), { timeoutMs: 20 });
    assert.ok(Date.now() - started < 1000);
    assert.ok(result.errors.some(error => error.includes("timed out")));
    let calls = 0;
    const exhausted = await collect(artifacts, async () => { calls++; return { stdout: "" }; }, { timeoutMs: 0 });
    assert.equal(calls, 0);
    assert.ok(exhausted.errors.some(error => error.includes("deadline")));
  });
});

test("all commands share a capped total deadline without retries", async () => {
  await fixture(async ({ artifacts }) => {
    let clock = END;
    const calls = [];
    const result = await collect(artifacts, async (_command, args, options) => {
      calls.push({ args, timeout: options.timeout });
      clock += Math.min(4999, options.timeout);
      return { stdout: args.includes("date") ? "+0000" : "", stderr: "" };
    }, { timeoutMs: 60000, now: () => clock });
    assert.ok(calls.every(call => call.timeout <= 5000));
    assert.ok(clock - END <= 15000);
    assert.ok(result.errors.some(error => error.includes("deadline")));
    assert.equal(new Set(calls.map(call => call.args.join(" "))).size, calls.length);
  });
});

test("physical devices are refused without commands or artifact writes", async () => {
  await fixture(async ({ artifacts }) => {
    let calls = 0;
    const result = await collect(artifacts, async () => { calls++; }, { udid: "physical-serial" });
    assert.equal(result.status, "refused");
    assert.equal(calls, 0);
    assert.deepEqual(readdirSync(artifacts), ["device-live.log"]);
  });
});

test("missing live launch evidence fails closed and never requests historical reports", async () => {
  await fixture(async ({ artifacts, read }) => {
    const calls = [];
    const result = await collect(artifacts, executor({}, (_command, args) => calls.push(args.join(" "))));
    assert.deepEqual(calls, ["-s emulator-5554 shell date +%z"]);
    assert.deepEqual(result.pids, []);
    assert.match(read("summary.json"), /No package launch/);
  }, launch("12:30:00.000", 4738));
});

test("missing timezone and an unwritable diagnostic directory remain best-effort results", async () => {
  await fixture(async ({ artifacts }) => {
    const missingZone = await collect(artifacts, executor({ "shell date +%z": "not a timezone" }));
    assert.ok(missingZone.errors.some(error => error.includes("timezone unavailable")));
    rmSync(join(artifacts, "android-crash-diagnostics"), { recursive: true });
    writeFileSync(join(artifacts, "android-crash-diagnostics"), "blocks directory creation");
    const unwritable = await collect(artifacts, executor());
    assert.equal(unwritable.status, "partial");
    assert.ok(unwritable.errors.some(error => error.includes("Cannot save")));
  });
});

test("loading the collector does not run diagnostics or write healthy-run artifacts", async () => {
  await fixture(async ({ artifacts }) => {
    await import("./android-crash-diagnostics.mjs");
    assert.deepEqual(readdirSync(artifacts), ["device-live.log"]);
  });
});
