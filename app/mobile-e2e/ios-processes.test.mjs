import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iosInteractionDiagnostics as makeDiagnostics, readLoggedIosAppPid, sampleIosFallback, samplePinnedIosApp as samplePinned } from "./ios-interaction-diagnostics.mjs";
import { iosAppLogPids, iosAppPids } from "./ios-processes.mjs";


const udid = "CD85F334-D4C3-44B6-A7B8-EAABB9C6C1B4";
const devicesRoot = "/Users/runner with spaces/Library/Developer/CoreSimulator/Devices";
const inspectorPath = "/owned/native-inspector";
const appPath = device => devicesRoot + "/" + device + "/data/Containers/Bundle/Application/51DBBA3D-91A6-4E0F-BE84-D779BCE6C0F3/BibleOnSite.app/BibleOnSite";
const OWNED = "8421 L " + appPath(udid) + "\n";
const samplePinnedIosApp = options => samplePinned({ devicesRoot, inspectorPath, ...options });
const iosInteractionDiagnostics = options => makeDiagnostics({ devicesRoot, inspectorPath, ...options });

// `launchctl list` answers for the one device it was spawned on, so a peer
// shard's app can never appear in the table — the rows below model a single
// simulator's own services.
const LISTING = [
  "PID\tStatus\tLabel",
  "-\t0\tcom.apple.SpringBoard",
  "8421\t0\tUIKitApplication:com.tanah.daily929[ab12]",
  "99\t0\tUIKitApplication:com.example.other[cd34]",
].join("\n");

test("returns the app's host PID from its own simulator's launchd table", () => {
  assert.deepEqual(iosAppPids(LISTING), ["8421"]);
});

test("ignores a registered app that is not running and unrelated labels", () => {
  const output = [
    "PID\tStatus\tLabel",
    "-\t0\tcom.apple.SpringBoard",
    "-\t0\tUIKitApplication:com.tanah.daily929[ef56]",
  ].join("\n");
  assert.deepEqual(iosAppPids(output), []);
});

test("returns nothing when the app never launched on the device", () => {
  assert.deepEqual(iosAppPids("PID\tStatus\tLabel\n-\t0\tcom.apple.SpringBoard\n"), []);
});

test("live-log identity collects only app metadata PIDs, including relaunches", () => {
  const log = [
    "2026-10-14 17:59:34.868 Df BibleOnSite[15058:b634] [reader-native] rendered",
    "2026-10-14 17:59:34.869 Df BibleOnSite[15058:b635] another message",
    "2026-10-14 17:59:34.870 Df BibleOnSite[2345:abc] relaunched",
    "2026-10-14 17:59:34.871 Df OtherApp[999:abc] BibleOnSite[888:abc] payload",
    "payload BibleOnSite[777:abc]",
  ].join("\n");
  assert.deepEqual(iosAppLogPids(log), [15058, 2345]);
  assert.deepEqual(iosAppLogPids(""), []);
});

test("device ownership ignores another bundle sharing the app's prefix", () => {
  assert.deepEqual(iosAppPids("999\t0\tUIKitApplication:com.tanah.daily929.other[aa]\n8421\t0\tUIKitApplication:com.tanah.daily929[bb]"), ["8421"]);
});

function diagnosticFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "ios-interaction-diagnostics-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const nativeLog = join(directory, "device-live.log");
  writeFileSync(nativeLog, "2026-10-28 16:32:01.000 Df BibleOnSite[8421:abc] foreground\n");
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === inspectorPath) return args[0] === "--threads"
      ? { stdout: `${args[1]} 259 W 0 0 main-thread\n`, stderr: "" }
      : { stdout: OWNED, stderr: "" };
    if (args.includes("screenshot")) writeFileSync(args.at(-1), "frame");
    return { stdout: "captured", stderr: "" };
  };
  const now = () => Date.parse("2026-10-28T16:33:00Z");
  return { directory, nativeLog, calls, execute, now };
}

function failureSignal(extra = {}) {
  return { id: "123456781234123412341234567890ab", test: "Preferences scenario", sessionId: "session-1",
    failedAtUtc: "2026-10-28T16:33:00Z", deadlineUtc: "2026-10-28T16:33:15Z", ...extra };
}

function pendingRequest(sequence, request = "SettingsDisplayRow") {
  return { sequence, command: "POST /session/session-1/elements", request,
    sessionId: "session-1", capturedAt: "2026-10-28T16:32:45Z", pending: true };
}

test("passive identity reads a bounded existing log tail without process probes", (t) => {
  const f = diagnosticFixture(t);
  writeFileSync(f.nativeLog, "old payload\n".repeat(50000) + "2026-10-28 16:32:02.000 Df BibleOnSite[9912:def] current\n");
  assert.equal(readLoggedIosAppPid(f.nativeLog), 9912);
  writeFileSync(f.nativeLog, "no recognized app identity\n");
  assert.equal(readLoggedIosAppPid(f.nativeLog), null);
});

test("distinct stalled requests preserve unique frames and original identities without intrusive queries", async (t) => {
  const f = diagnosticFixture(t);
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid: udid, ...f });
  const calendar = pendingRequest(1, "CalendarYear");
  await diagnostics.capture(calendar.command, calendar);
  calendar.pending = false; calendar.status = 200;
  writeFileSync(f.nativeLog, "2026-10-28 16:32:02.000 Df BibleOnSite[9912:def] relaunched\n");
  const preferences = pendingRequest(2);
  await diagnostics.capture(preferences.command, preferences);
  assert.deepEqual(f.calls.map(x => x.args.slice(0, 4)), [
    ["simctl", "io", udid, "screenshot"], ["--threads", "8421"],
    ["simctl", "io", udid, "screenshot"], ["--threads", "9912"],
  ]);
  assert.ok(f.calls.every(x => x.options.timeout === 5000));
  const first = JSON.parse(readFileSync(join(f.directory, "native-interaction-0001.json"), "utf8"));
  const second = JSON.parse(readFileSync(join(f.directory, "native-interaction-0002.json"), "utf8"));
  assert.equal(first.pid, 8421); assert.equal(second.pid, 9912);
  assert.notEqual(first.prefix, second.prefix);
  assert.equal(readdirSync(f.directory).filter(x => x.endsWith(".png")).length, 2);
  // The in-flight kernel thread states land beside each frame attempt.
  assert.equal(readFileSync(join(f.directory, "native-interaction-0001-threads.txt"), "utf8"), "8421 259 W 0 0 main-thread\n");
  assert.equal(readFileSync(join(f.directory, "native-interaction-0002-threads.txt"), "utf8"), "9912 259 W 0 0 main-thread\n");
});

test("failure handoff samples the pinned process while all existing caps remain unchanged", async (t) => {
  const f = diagnosticFixture(t);
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid: udid, ...f });
  const request = pendingRequest(1);
  await diagnostics.capture(request.command, request);
  request.pending = false; request.status = 500;
  f.calls.length = 0;
  assert.deepEqual(await diagnostics.failure(failureSignal()), { status: "captured", pid: 8421 });
  assert.deepEqual(f.calls.map(x => x.command), [inspectorPath, "xcrun", inspectorPath, "sudo"]);
  assert.deepEqual(f.calls.map(x => x.options.timeout), [5000, 5000, 5000, 10000]);
  assert.ok(f.calls.every(x => x.options.signal === f.calls[0].options.signal));
  assert.ok(f.calls.at(-1).args.includes("8421"));
  assert.ok(f.calls.at(-1).args.includes("settings set target.detach-on-error true"));
  const evidence = JSON.parse(readFileSync(join(f.directory, `native-failure-${failureSignal().id}.json`), "utf8"));
  assert.equal(evidence.request.test, "Preferences scenario");
  assert.equal(evidence.observation.request.status, 500);
  // Kernel thread rows still land when host debugger channels cannot run.
  assert.equal(readFileSync(join(f.directory, `native-failure-${failureSignal().id}-threads-8421.txt`), "utf8"),
    "8421 259 W 0 0 main-thread\n");
});

for (const listing of ["", "9912 L " + appPath(udid), "8421 L " + appPath("B8D3DB6B-98FB-4E92-9ACE-9BC307F7FDE7"), "8421 Z " + appPath(udid)]) {
  test(`exited or replaced pinned process never samples a later app: ${listing.trim()}`, async (t) => {
    const f = diagnosticFixture(t);
    const result = await samplePinnedIosApp({ udid: udid, pid: 8421,
      prefix: join(f.directory, "failed"), deadlineUtc: failureSignal().deadlineUtc, now: f.now,
      execute: async (command, args, options) => { f.calls.push({ command, args, options }); return { stdout: listing }; } });
    assert.equal(result.status, "exited"); assert.equal(result.pid, 8421);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].command, inspectorPath);
    assert.deepEqual(f.calls[0].args, ["8421"]);
  });
}

test("successful earlier captures and a different session cannot identify the failed scenario", async (t) => {
  const f = diagnosticFixture(t);
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid: udid, ...f });
  const calendar = pendingRequest(1);
  await diagnostics.capture(calendar.command, calendar);
  calendar.pending = false; calendar.status = 200;
  f.calls.length = 0;
  assert.equal((await diagnostics.failure(failureSignal())).status, "unknown");
  assert.equal((await diagnostics.failure(failureSignal({ sessionId: "other-session" }))).status, "unknown");
  assert.deepEqual(f.calls, []);
});

test("unknown identity and expired failure deadline never invoke native tools", async (t) => {
  const f = diagnosticFixture(t);
  for (const [pid, deadlineUtc, status] of [[null, failureSignal().deadlineUtc, "unknown"],
    [8421, "2026-10-28T16:32:59Z", "expired"]]) {
    const result = await samplePinnedIosApp({ udid: udid, pid, prefix: join(f.directory, "failure"),
      deadlineUtc, execute: f.execute, now: f.now });
    assert.equal(result.status, status);
  }
  assert.deepEqual(f.calls, []);
});

test("failed passive reads retain identity errors and cannot trigger a replacement sample", async (t) => {
  const f = diagnosticFixture(t);
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid: udid, ...f,
    readPid() { throw new Error("native log unavailable"); } });
  const request = pendingRequest(1);
  await diagnostics.capture(request.command, request);
  const evidence = JSON.parse(readFileSync(join(f.directory, "native-interaction-0001.json"), "utf8"));
  assert.equal(evidence.pid, null); assert.equal(evidence.identityError.message, "native log unavailable");
  assert.equal(evidence.threadsError.message, "No pinned app identity is available for kernel thread enumeration.");
  assert.ok(readdirSync(f.directory).includes("native-interaction-0001-threads-error.json"));
  f.calls.length = 0;
  assert.equal((await diagnostics.failure(failureSignal())).status, "unknown");
  assert.deepEqual(f.calls, []);
});

test("failure sampling retains command errors without changing the original test result", async (t) => {
  const f = diagnosticFixture(t);
  const failure = Object.assign(new Error("host inspector unavailable"), { killed: true, signal: "SIGTERM" });
  const result = await samplePinnedIosApp({ udid: udid, pid: 8421,
    prefix: join(f.directory, "failed"), deadlineUtc: failureSignal().deadlineUtc, now: f.now,
    execute: async () => { throw failure; } });
  assert.equal(result.status, "error"); assert.equal(result.error.killed, true);
  assert.equal(JSON.parse(readFileSync(join(f.directory, "failed-stack-error.json"), "utf8")).signal, "SIGTERM");
});

test("a stuck simulator frame cannot block the independently captured pinned stack", async t => {
  const f = diagnosticFixture(t);
  let finishFrame;
  const frame = new Promise((_, reject) => { finishFrame = reject; });
  const result = await samplePinnedIosApp({ udid, pid: 8421,
    prefix: join(f.directory, "stuck-frame"), deadlineUtc: failureSignal().deadlineUtc, now: f.now,
    execute: async (command, args, options) => {
      f.calls.push({ command, args, options });
      if (command === inspectorPath) return { stdout: args[0] === "--threads" ? "8421 259 W 0 0 main-thread\n" : OWNED, stderr: "" };
      if (args.includes("screenshot")) return frame;
      assert.equal(command, "sudo");
      assert.ok(f.calls.some(call => call.args.includes("screenshot")));
      finishFrame(Object.assign(new Error("simulator unresponsive"), { killed: true, signal: "SIGTERM" }));
      return { stdout: "pinned stack", stderr: "" };
    } });
  assert.equal(result.status, "error", "the failed frame remains an error");
  assert.equal(result.frameError.signal, "SIGTERM");
  assert.equal(readFileSync(join(f.directory, "stuck-frame-stack-8421.txt"), "utf8"), "pinned stack");
  assert.equal(readFileSync(join(f.directory, "stuck-frame-threads-8421.txt"), "utf8"), "8421 259 W 0 0 main-thread\n");
  assert.deepEqual(f.calls.map(call => call.options.timeout), [5000, 5000, 5000, 10000]);
  assert.ok(f.calls.every(call => call.options.signal === f.calls[0].options.signal));
  assert.ok(f.calls.every(call => !call.args.includes("spawn") && call.command !== "ps"));
});

test("a killed kernel thread capture retains its own error beside surviving evidence", async (t) => {
  const f = diagnosticFixture(t);
  const threadsKilled = Object.assign(new Error("thread enumeration killed"), { killed: true, signal: "SIGTERM" });
  const result = await samplePinnedIosApp({ udid, pid: 8421,
    prefix: join(f.directory, "dead-threads"), deadlineUtc: failureSignal().deadlineUtc, now: f.now,
    execute: async (command, args, options) => {
      f.calls.push({ command, args, options });
      if (command === inspectorPath && args[0] === "--threads") throw threadsKilled;
      if (command === inspectorPath) return { stdout: OWNED, stderr: "" };
      if (args.includes("screenshot")) writeFileSync(args.at(-1), "frame");
      return { stdout: "pinned stack", stderr: "" };
    } });
  assert.equal(result.status, "error", "a failed kernel capture keeps the error status");
  assert.equal(result.threadsError.signal, "SIGTERM");
  assert.equal(JSON.parse(readFileSync(join(f.directory, "dead-threads-threads-error.json"), "utf8")).signal, "SIGTERM");
  assert.equal(readFileSync(join(f.directory, "dead-threads-stack-8421.txt"), "utf8"), "pinned stack");
  assert.equal(readFileSync(join(f.directory, "dead-threads.png"), "utf8"), "frame");
});

test("a failed debugger still waits for frame capture before releasing the scenario handoff", async t => {
  const f = diagnosticFixture(t);
  let finishFrame;
  const frame = new Promise(resolve => { finishFrame = resolve; });
  let completed = false;
  const sampling = samplePinnedIosApp({ udid, pid: 8421,
    prefix: join(f.directory, "failed-debugger"), deadlineUtc: failureSignal().deadlineUtc, now: f.now,
    execute: async (command, args) => {
      if (command === inspectorPath) return { stdout: OWNED, stderr: "" };
      if (args.includes("screenshot")) {
        await frame;
        writeFileSync(args.at(-1), "completed frame");
        return { stdout: "", stderr: "" };
      }
      throw new Error("debugger unavailable");
    } }).then(result => { completed = true; return result; });
  await new Promise(setImmediate);
  assert.equal(completed, false);
  finishFrame();
  const result = await sampling;
  assert.equal(result.status, "error");
  assert.equal(result.error.message, "debugger unavailable");
  assert.equal(readFileSync(join(f.directory, "failed-debugger.png"), "utf8"), "completed frame");
});

for (const [inspector, stderr, message] of [[undefined, "", "prepared native"],
  ["relative-inspector", "", "prepared native"], [inspectorPath, "kernel inspection denied", "kernel inspection denied"]]) {
  test(`failure sampling rejects unavailable ownership proof: ${inspector}/${stderr}`, async t => {
    const f = diagnosticFixture(t);
    const result = await samplePinnedIosApp({ udid, pid: 8421, inspectorPath: inspector,
      prefix: join(f.directory, "unproved"), deadlineUtc: failureSignal().deadlineUtc, now: f.now,
      execute: async (command, args) => {
        f.calls.push({ command, args });
        return { stdout: OWNED, stderr };
      } });
    assert.equal(result.status, "error");
    assert.ok(result.error.message.includes(message));
    assert.equal(f.calls.length, inspector === inspectorPath ? 1 : 0);
  });
}

test("handoff deadline cancellation stops before another native command or debugger attach", async (t) => {
  const f = diagnosticFixture(t);
  const cancellation = new AbortController();
  const result = await samplePinnedIosApp({ udid: udid, pid: 8421,
    prefix: join(f.directory, "cancelled"), deadlineUtc: failureSignal().deadlineUtc, now: f.now,
    signal: cancellation.signal,
    execute: async (command, args, options) => {
      f.calls.push({ command, args, options });
      cancellation.abort(new Error("failure handoff deadline expired"));
      return { stdout: OWNED, stderr: "" };
    } });
  assert.equal(result.status, "error");
  assert.equal(result.error.message, "failure handoff deadline expired");
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].options.signal.aborted);
});

for (const [observer, confirmed] of [[{ received: 1 }, true], [{ received: 0 }, false], [undefined, true]]) {
  test(`uncertain or already handled failure never samples a later survivor: ${JSON.stringify({ observer, confirmed })}`, async () => {
    let calls = 0;
    const result = await sampleIosFallback(observer, confirmed, async () => { calls++; });
    assert.equal(result.status, "unknown");
    assert.equal(calls, 0);
  });
}

test("clean observer shutdown with no handoff retains the existing fallback", async () => {
  let calls = 0;
  const result = await sampleIosFallback({ received: 0 }, true, async () => { calls++; });
  assert.equal(result.status, "fallback-attempted");
  assert.equal(calls, 1);
});
