import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iosInteractionDiagnostics as makeDiagnostics, readLoggedIosAppPid, sampleIosFallback, samplePinnedIosApp as samplePinned } from "./ios-interaction-diagnostics.mjs";
import { iosAppLogPids, iosAppPids } from "./ios-processes.mjs";
import { monitorNativeInteractions } from "./native-hang-monitor.mjs";


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
    if (command === "/usr/bin/sample") writeFileSync(args.at(-1), "sampled native stack");
    return { stdout: "captured", stderr: "" };
  };
  const now = () => Date.parse("2026-10-28T16:33:00Z");
  return { directory, nativeLog, calls, execute, now };
}

function failureSignal(extra = {}) {
  return { id: "123456781234123412341234567890ab", test: "Preferences scenario", sessionId: "session-1",
    failedAtUtc: "2026-10-28T16:33:00Z", deadlineUtc: "2026-10-28T16:33:15Z", ...extra };
}

function startupFailure(extra = {}) {
  return failureSignal({ failurePhase: "reader-startup", launchId: "815d55be-d9fc-47ac-85d8-983b58a43998",
    scenarioStartedAtUtc: "2026-10-28T16:32:10Z", ...extra });
}

function pendingRequest(sequence, request = "SettingsDisplayRow") {
  return { sequence, command: "POST /session/session-1/elements", request,
    sessionId: "session-1", startedAt: "2026-10-28T16:32:20Z", capturedAt: "2026-10-28T16:32:45Z", pending: true };
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
  assert.deepEqual(f.calls.map(x => x.command), [inspectorPath, "xcrun", inspectorPath, "/usr/bin/sample", inspectorPath, "sudo"]);
  assert.deepEqual(f.calls.map(x => x.options.timeout), [5000, 5000, 5000, 5000, 5000, 10000]);
  assert.ok(f.calls.every(x => x.options.signal === f.calls[0].options.signal));
  assert.ok(f.calls.at(-1).args.includes("8421"));
  assert.ok(f.calls.at(-1).args.includes("settings set target.detach-on-error true"));
  const evidence = JSON.parse(readFileSync(join(f.directory, `native-failure-${failureSignal().id}.json`), "utf8"));
  assert.equal(evidence.request.test, "Preferences scenario");
  assert.equal(evidence.observation.request.status, 500);
  // Kernel thread rows still land when host debugger channels cannot run.
  assert.equal(readFileSync(join(f.directory, `native-failure-${failureSignal().id}-threads-8421.txt`), "utf8"),
    "8421 259 W 0 0 main-thread\n");
  assert.equal(readFileSync(join(f.directory, `native-failure-${failureSignal().id}-sample-8421.txt`), "utf8"),
    "sampled native stack");
});

test("confirmed reader startup failure pins its current app without any pending native request", async t => {
  const f = diagnosticFixture(t);
  let reads = 0;
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f,
    readPid() { reads++; return 8421; } });
  assert.equal(reads, 0, "healthy startup does not inspect or pin an app");
  assert.deepEqual(f.calls, []);
  const failure = startupFailure();

  assert.deepEqual(await diagnostics.failure(failure), { status: "captured", pid: 8421 });
  assert.equal(reads, 1);
  assert.deepEqual(f.calls.map(call => call.command),
    [inspectorPath, "xcrun", inspectorPath, "/usr/bin/sample", inspectorPath, "sudo"]);
  assert.deepEqual(f.calls.map(call => call.options.timeout), [5000, 5000, 5000, 5000, 5000, 10000]);
  assert.ok(f.calls.every(call => call.options.signal === f.calls[0].options.signal));
  const evidence = JSON.parse(readFileSync(join(f.directory, `native-failure-${failure.id}.json`), "utf8"));
  assert.equal(evidence.observation.pid, 8421);
  assert.equal(evidence.observation.failurePhase, "reader-startup");
  assert.equal(evidence.observation.launchId, failure.launchId);
  assert.equal(evidence.observation.sessionId, failure.sessionId);
  assert.equal(evidence.observation.source, "existing UDID-scoped native log at confirmed reader-startup failure");
  assert.equal(evidence.observation.observedAt, new Date(f.now()).toISOString());
  assert.equal(evidence.observation.request, undefined);
});

test("reader startup accepts .NET UTC timestamps with seven fractional digits and an explicit offset", async t => {
  const f = diagnosticFixture(t);
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f });
  const failure = startupFailure({ scenarioStartedAtUtc: "2026-10-28T16:32:10.0123456+00:00",
    failedAtUtc: "2026-10-28T16:32:59.1234567+00:00", deadlineUtc: "2026-10-28T16:33:14.1234567+00:00" });

  assert.deepEqual(await diagnostics.failure(failure), { status: "captured", pid: 8421 });
  assert.ok(f.calls.some(call => call.command === "/usr/bin/sample"));
  assert.ok(f.calls.some(call => call.command === "sudo"));
  const evidence = JSON.parse(readFileSync(join(f.directory, `native-failure-${failure.id}.json`), "utf8"));
  assert.equal(evidence.observation.scenarioStartedAtUtc, failure.scenarioStartedAtUtc);
  assert.equal(evidence.request.deadlineUtc, failure.deadlineUtc);
});

for (const [label, context] of [
  ["a one-character ASCII session", { sessionId: "A" }],
  ["a hyphen-only session", { sessionId: "-" }],
  ["a 128-character mixed ASCII session", { sessionId: "Az09-".repeat(25) + "aZ9" }],
  ["a canonical all-zero launch UUID", { launchId: "00000000-0000-0000-0000-000000000000" }],
]) test(`reader startup accepts ${label}`, async t => {
  const f = diagnosticFixture(t);
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f });
  const failure = startupFailure(context);

  assert.deepEqual(await diagnostics.failure(failure), { status: "captured", pid: 8421 });
  const evidence = JSON.parse(readFileSync(join(f.directory, `native-failure-${failure.id}.json`), "utf8"));
  assert.equal(evidence.observation.sessionId, failure.sessionId);
  assert.equal(evidence.observation.launchId, failure.launchId);
});

test("reader startup never attributes an earlier interaction's PID to the current launch", async t => {
  const f = diagnosticFixture(t);
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f,
    execute: async (command, args, options) => {
      const result = await f.execute(command, args, options);
      return command === inspectorPath && args[0] !== "--threads"
        ? { stdout: "9912 L " + appPath(udid), stderr: "" } : result;
    } });
  const earlier = pendingRequest(1, "terminate_app");
  await diagnostics.capture(earlier.command, earlier);
  earlier.pending = false;
  earlier.status = 500;
  writeFileSync(f.nativeLog, "2026-10-28 16:32:59.000 Df BibleOnSite[9912:def] current launch\n");
  f.calls.length = 0;

  assert.deepEqual(await diagnostics.failure(startupFailure()), { status: "captured", pid: 9912 });
  assert.deepEqual(f.calls[0].args, ["9912"]);
  assert.ok(f.calls.every(call => !call.args.includes("8421")));
  const evidence = JSON.parse(readFileSync(join(f.directory, `native-failure-${failureSignal().id}.json`), "utf8"));
  assert.equal(evidence.observation.pid, 9912);
  assert.equal(evidence.observation.capturedRequest, undefined);
});

test("ordinary failure with null startup fields retains its original interaction pin", async t => {
  const f = diagnosticFixture(t);
  let reads = 0;
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f,
    readPid() { reads++; return reads === 1 ? 8421 : 9912; } });
  const request = pendingRequest(1);
  await diagnostics.capture(request.command, request);
  f.calls.length = 0;

  assert.deepEqual(await diagnostics.failure(failureSignal({ failurePhase: null, launchId: null })),
    { status: "captured", pid: 8421 });
  assert.equal(reads, 1, "ordinary failures cannot select a newly logged process");
  assert.deepEqual(f.calls[0].args, ["8421"]);
});

for (const [label, context] of [
  ["missing phase", { failurePhase: undefined }],
  ["null phase", { failurePhase: null }],
  ["ordinary phase", { failurePhase: "scenario" }],
  ["missing launch identity", { launchId: undefined }],
  ["null launch identity", { launchId: null }],
  ["malformed launch identity", { launchId: "not-a-guid" }],
  ["noncanonical launch identity", { launchId: "815D55BE-D9FC-47AC-85D8-983B58A43998" }],
  ["misplaced launch separator", { launchId: "815d55bead9fc-47ac-85d8-983b58a43998" }],
  ["nonhex launch character", { launchId: "g15d55be-d9fc-47ac-85d8-983b58a43998" }],
  ["separator in launch hex", { launchId: "815d55be-d9fc-47ac-85d8-983b58a4399-" }],
  ["launch identity with newline", { launchId: "815d55be-d9fc-47ac-85d8-983b58a43998\n" }],
  ["missing session", { sessionId: undefined }],
  ["null session", { sessionId: null }],
  ["empty session", { sessionId: "" }],
  ["blank session", { sessionId: " " }],
  ["malformed session", { sessionId: "session/other" }],
  ["overlong session", { sessionId: "A".repeat(129) }],
  ["non-ASCII session", { sessionId: "sessiön-1" }],
  ["session underscore", { sessionId: "session_1" }],
  ["session with newline", { sessionId: "session-1\n" }],
  ["missing startup boundary", { scenarioStartedAtUtc: undefined }],
  ["invalid startup boundary", { scenarioStartedAtUtc: "not-a-date" }],
  ["non-UTC startup boundary", { scenarioStartedAtUtc: "2026-10-28T18:32:10+02:00" }],
  ["startup boundary with newline", { scenarioStartedAtUtc: "2026-10-28T16:32:10Z\n" }],
  ["startup after failure", { scenarioStartedAtUtc: "2026-10-28T16:33:01Z" }],
  ["missing failure time", { failedAtUtc: undefined }],
  ["invalid calendar failure time", { failedAtUtc: "2026-02-30T16:33:00Z" }],
  ["failure time with newline", { failedAtUtc: "2026-10-28T16:33:00Z\n" }],
  ["future failure time", { failedAtUtc: "2026-10-28T16:33:01Z" }],
  ["missing deadline", { deadlineUtc: undefined }],
  ["invalid deadline", { deadlineUtc: "not-a-date" }],
  ["deadline before failure", { deadlineUtc: "2026-10-28T16:32:59Z" }],
  ["expanded deadline", { deadlineUtc: "2026-10-28T16:33:16Z" }],
]) test(`incomplete reader startup context rejects ${label} without pinning or attaching`, async t => {
  const f = diagnosticFixture(t);
  let reads = 0;
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f,
    readPid() { reads++; return 8421; } });
  const earlier = pendingRequest(1);
  await diagnostics.capture(earlier.command, earlier);
  f.calls.length = 0;
  reads = 0;

  assert.equal((await diagnostics.failure(startupFailure(context))).status, "unknown");
  assert.equal(reads, 0, "invalid startup context cannot fall back to an earlier interaction");
  assert.deepEqual(f.calls, []);
  const evidence = JSON.parse(readFileSync(join(f.directory, `native-failure-${failureSignal().id}.json`), "utf8"));
  assert.equal(evidence.observation, null);
});

test("failed startup PID reads retain their error and never inspect a replacement", async t => {
  const f = diagnosticFixture(t);
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f,
    readPid() { throw new Error("startup native log unavailable"); } });
  assert.deepEqual(await diagnostics.failure(startupFailure()), { status: "unknown", pid: null });
  assert.deepEqual(f.calls, []);
  const evidence = JSON.parse(readFileSync(join(f.directory, `native-failure-${failureSignal().id}.json`), "utf8"));
  assert.equal(evidence.observation.pid, null);
  assert.equal(evidence.observation.identityError.message, "startup native log unavailable");
});

for (const listing of ["", "9912 L " + appPath(udid), "8421 L " + appPath("B8D3DB6B-98FB-4E92-9ACE-9BC307F7FDE7"), "8421 Z " + appPath(udid)]) {
  test(`startup ownership rejection never chooses another app: ${listing.trim()}`, async t => {
    const f = diagnosticFixture(t);
    const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f,
      execute: async (command, args, options) => {
        f.calls.push({ command, args, options });
        return { stdout: listing, stderr: "" };
      } });
    const result = await diagnostics.failure(startupFailure());
    assert.equal(result.status, "exited");
    assert.equal(result.pid, 8421);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].command, inspectorPath);
    assert.deepEqual(f.calls[0].args, ["8421"]);
  });
}

test("reader startup capture retains the remaining deadline and handoff cancellation", async t => {
  const f = diagnosticFixture(t);
  const expired = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f,
    now: () => f.now() + 15000 });
  assert.deepEqual(await expired.failure(startupFailure()), { status: "expired", pid: 8421 });
  assert.deepEqual(f.calls, []);
  const cancellation = new AbortController();
  cancellation.abort(new Error("startup handoff ended"));
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f });
  const result = await diagnostics.failure(startupFailure(), { signal: cancellation.signal });
  assert.equal(result.status, "error");
  assert.equal(result.error.message, "startup handoff ended");
  assert.deepEqual(f.calls, []);
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

test("a completed HTTP 200 lookup retains its pending capture identity within the failed scenario", async t => {
  const f = diagnosticFixture(t);
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f });
  let capture;
  let threshold;
  const timestamps = ["2026-10-28T16:32:20Z", "2026-10-28T16:32:45Z", "2026-10-28T16:32:58Z"];
  const monitor = monitorNativeInteractions(async (command, request) => {
    capture = await diagnostics.capture(command, request);
  }, { schedule: callback => { threshold = callback; }, cancel: () => undefined, now: () => timestamps.shift() });
  monitor.write('[HTTP] --> POST /session/session-1/elements {"value":"CircularMenuButton"}\n');
  threshold();
  // The response arrives before the queued capture has begun reading the request.
  monitor.write('[HTTP] <-- POST /session/session-1/elements 200 122700 ms\n');
  await monitor.stop();
  assert.ok(Object.isFrozen(capture.capturedRequest));
  assert.equal(capture.request.pending, false);
  assert.equal(capture.request.status, 200);
  assert.equal(capture.request.capturedWhilePending, true);
  assert.throws(() => { capture.request.capturedWhilePending = false; }, TypeError);
  assert.equal(capture.capturedRequest.pending, true);
  assert.ok(f.calls.every(call => call.command !== "/usr/bin/sample" && call.command !== "sudo"));
  f.calls.length = 0;

  const failure = failureSignal({ scenarioStartedAtUtc: "2026-10-28T16:32:10Z" });
  assert.deepEqual(await diagnostics.failure(failure), { status: "captured", pid: 8421 });
  const evidence = JSON.parse(readFileSync(join(f.directory, `native-failure-${failure.id}.json`), "utf8"));
  assert.equal(evidence.observation.request.status, 200);
  assert.equal(evidence.observation.request.pending, false);
  assert.equal(evidence.observation.capturedRequest.pending, true);
  assert.equal(evidence.request.scenarioStartedAtUtc, failure.scenarioStartedAtUtc);
  assert.ok(f.calls.some(call => call.command === "sudo"));
});

for (const [label, observation, failure] of [
  ["earlier passing calendar", {}, { scenarioStartedAtUtc: "2026-10-28T16:32:50Z" }],
  ["request crossing the scenario boundary", { capturedAt: "2026-10-28T16:32:55Z" }, { scenarioStartedAtUtc: "2026-10-28T16:32:50Z" }],
  ["different session", {}, { scenarioStartedAtUtc: "2026-10-28T16:32:10Z", sessionId: "other-session" }],
  ["capture after failure", { capturedAt: "2026-10-28T16:33:01Z" }, { scenarioStartedAtUtc: "2026-10-28T16:32:10Z" }],
  ["invalid capture time", { capturedAt: "not-a-date" }, { scenarioStartedAtUtc: "2026-10-28T16:32:10Z" }],
  ["missing request start", { startedAt: undefined }, { scenarioStartedAtUtc: "2026-10-28T16:32:10Z" }],
  ["invalid boundary", {}, { scenarioStartedAtUtc: "not-a-date" }],
  ["boundary after failure", {}, { scenarioStartedAtUtc: "2026-10-28T16:33:01Z" }],
  ["capture preceding request", { startedAt: "2026-10-28T16:32:50Z" }, { scenarioStartedAtUtc: "2026-10-28T16:32:10Z" }],
  ["request already complete at capture", { pending: false }, { scenarioStartedAtUtc: "2026-10-28T16:32:10Z" }],
  ["explicitly nonpending capture", { capturedWhilePending: false }, { scenarioStartedAtUtc: "2026-10-28T16:32:10Z" }],
]) test(`scenario boundary rejects ${label} without sampling`, async t => {
  const f = diagnosticFixture(t);
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f });
  const request = { ...pendingRequest(1), ...observation };
  await diagnostics.capture(request.command, request);
  request.pending = false;
  request.status = 200;
  f.calls.length = 0;

  assert.equal((await diagnostics.failure(failureSignal(failure))).status, "unknown");
  assert.deepEqual(f.calls, []);
});

test("an invalid failure time cannot select a legacy pending capture", async t => {
  const f = diagnosticFixture(t);
  const diagnostics = iosInteractionDiagnostics({ artifacts: f.directory, udid, ...f });
  const request = pendingRequest(1);
  await diagnostics.capture(request.command, request);
  f.calls.length = 0;

  assert.equal((await diagnostics.failure(failureSignal({ failedAtUtc: "not-a-date" }))).status, "unknown");
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
      if (command === "/usr/bin/sample") {
        writeFileSync(args.at(-1), "sampled native stack");
        return { stdout: "", stderr: "" };
      }
      assert.equal(command, "sudo");
      assert.ok(f.calls.some(call => call.args.includes("screenshot")));
      finishFrame(Object.assign(new Error("simulator unresponsive"), { killed: true, signal: "SIGTERM" }));
      return { stdout: "pinned stack", stderr: "" };
    } });
  assert.equal(result.status, "error", "the failed frame remains an error");
  assert.equal(result.frameError.signal, "SIGTERM");
  assert.equal(readFileSync(join(f.directory, "stuck-frame-stack-8421.txt"), "utf8"), "pinned stack");
  assert.equal(readFileSync(join(f.directory, "stuck-frame-threads-8421.txt"), "utf8"), "8421 259 W 0 0 main-thread\n");
  assert.deepEqual(f.calls.map(call => call.options.timeout), [5000, 5000, 5000, 5000, 5000, 10000]);
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

test("a native sample finishes before debugger attachment and survives a failed debugger", async t => {
  const f = diagnosticFixture(t);
  let finishSample;
  const sample = new Promise(resolve => { finishSample = resolve; });
  const sampling = samplePinnedIosApp({ udid, pid: 8421,
    prefix: join(f.directory, "sample-before-debugger"), deadlineUtc: failureSignal().deadlineUtc, now: f.now,
    execute: async (command, args, options) => {
      if (command === "/usr/bin/sample") {
        f.calls.push({ command, args, options });
        assert.deepEqual(args, ["8421", "1", "-file", join(f.directory, "sample-before-debugger-sample-8421.txt")]);
        writeFileSync(args.at(-1), "native call tree\nmain-thread waiting in InitializeComponent");
        await sample;
        return { stdout: "", stderr: "" };
      }
      if (command === "sudo") {
        f.calls.push({ command, args, options });
        throw Object.assign(new Error("debugger attach timed out"), { killed: true, signal: "SIGTERM" });
      }
      return f.execute(command, args, options);
    } });
  await new Promise(setImmediate);
  assert.ok(f.calls.some(call => call.command === "/usr/bin/sample"));
  assert.ok(f.calls.every(call => call.command !== "sudo"), "LLDB cannot suspend an active sample");
  finishSample();
  const result = await sampling;
  assert.equal(result.status, "error");
  assert.equal(result.error.signal, "SIGTERM");
  assert.equal(readFileSync(join(f.directory, "sample-before-debugger-sample-8421.txt"), "utf8"),
    "native call tree\nmain-thread waiting in InitializeComponent");
  assert.equal(JSON.parse(readFileSync(join(f.directory, "sample-before-debugger-stack-error.json"), "utf8")).signal,
    "SIGTERM");
});

test("a killed native sample retains partial output and falls back to the existing debugger", async t => {
  const f = diagnosticFixture(t);
  const sampleKilled = Object.assign(new Error("sample timed out"), { killed: true, signal: "SIGTERM" });
  const result = await samplePinnedIosApp({ udid, pid: 8421,
    prefix: join(f.directory, "partial-sample"), deadlineUtc: failureSignal().deadlineUtc, now: f.now,
    execute: async (command, args, options) => {
      if (command === "/usr/bin/sample") {
        f.calls.push({ command, args, options });
        writeFileSync(args.at(-1), "partial native call tree");
        throw sampleKilled;
      }
      return f.execute(command, args, options);
    } });
  assert.equal(result.status, "captured", "a successful debugger remains usable after a failed sample");
  assert.equal(result.sampleError.signal, "SIGTERM");
  assert.equal(readFileSync(join(f.directory, "partial-sample-sample-8421.txt"), "utf8"), "partial native call tree");
  assert.equal(JSON.parse(readFileSync(join(f.directory, "partial-sample-sample-error.json"), "utf8")).signal, "SIGTERM");
  assert.equal(readFileSync(join(f.directory, "partial-sample-stack-8421.txt"), "utf8"), "captured");
  assert.ok(f.calls.at(-1).args.includes("--attach-pid"));
});

for (const listing of ["", "8421 Z " + appPath(udid), "8421 L " + appPath("B8D3DB6B-98FB-4E92-9ACE-9BC307F7FDE7")]) {
  test(`a process replaced during sample never reaches debugger attachment: ${listing.trim()}`, async t => {
    const f = diagnosticFixture(t);
    let sampled = false;
    const result = await samplePinnedIosApp({ udid, pid: 8421,
      prefix: join(f.directory, "replaced-after-sample"), deadlineUtc: failureSignal().deadlineUtc, now: f.now,
      execute: async (command, args, options) => {
        if (sampled && command === inspectorPath && args[0] !== "--threads") {
          f.calls.push({ command, args, options });
          return { stdout: listing, stderr: "" };
        }
        const captured = await f.execute(command, args, options);
        if (command === "/usr/bin/sample") sampled = true;
        return captured;
      } });
    assert.equal(result.status, "error");
    assert.equal(result.error.message, "Pinned process no longer belongs to this simulator; no debugger attached.");
    assert.ok(f.calls.every(call => call.command !== "sudo"));
    assert.equal(readFileSync(join(f.directory, "replaced-after-sample-process-8421.txt"), "utf8"), OWNED);
    assert.equal(readFileSync(join(f.directory, "replaced-after-sample-before-debugger-processes.txt"), "utf8"), listing);
    assert.equal(readFileSync(join(f.directory, "replaced-after-sample-sample-8421.txt"), "utf8"), "sampled native stack");
  });
}

test("ownership inspection and native sampling share the existing fifteen-second debugger budget", async t => {
  const f = diagnosticFixture(t);
  let clock = f.now();
  const result = await samplePinnedIosApp({ udid, pid: 8421,
    prefix: join(f.directory, "remaining-budget"), deadlineUtc: "2026-10-28T17:33:00Z", now: () => clock,
    execute: async (command, args, options) => {
      if (command === inspectorPath && args[0] !== "--threads" && f.calls.length === 0) clock += 5000;
      if (command === "/usr/bin/sample") clock += 3000;
      return f.execute(command, args, options);
    } });
  assert.equal(result.status, "captured");
  assert.deepEqual(f.calls.map(call => call.options.timeout), [5000, 5000, 5000, 5000, 5000, 7000]);
  assert.ok(f.calls.every(call => call.options.signal === f.calls[0].options.signal));
});

test("a native sample cannot start a debugger after consuming the remaining handoff deadline", async t => {
  const f = diagnosticFixture(t);
  let clock = f.now();
  const result = await samplePinnedIosApp({ udid, pid: 8421,
    prefix: join(f.directory, "sample-deadline"), deadlineUtc: "2026-10-28T16:33:05Z", now: () => clock,
    execute: async (command, args, options) => {
      if (command === inspectorPath && args[0] !== "--threads") clock += 1000;
      if (command === "/usr/bin/sample") clock += 4000;
      return f.execute(command, args, options);
    } });
  assert.equal(result.status, "error");
  assert.equal(result.error.message, "Failure sampling deadline expired.");
  assert.equal(f.calls.at(-1).command, "/usr/bin/sample");
  assert.equal(f.calls.at(-1).options.timeout, 4000);
  assert.equal(readFileSync(join(f.directory, "sample-deadline-sample-8421.txt"), "utf8"), "sampled native stack");
  assert.ok(f.calls.every(call => call.command !== "sudo"));
});

test("handoff cancellation during sample prevents another ownership probe or debugger attachment", async t => {
  const f = diagnosticFixture(t);
  const cancellation = new AbortController();
  const result = await samplePinnedIosApp({ udid, pid: 8421,
    prefix: join(f.directory, "cancelled-after-sample"), deadlineUtc: failureSignal().deadlineUtc, now: f.now,
    signal: cancellation.signal,
    execute: async (command, args, options) => {
      const captured = await f.execute(command, args, options);
      if (command === "/usr/bin/sample") cancellation.abort(new Error("handoff cancelled during sample"));
      return captured;
    } });
  assert.equal(result.status, "error");
  assert.equal(result.error.message, "handoff cancelled during sample");
  assert.equal(f.calls.at(-1).command, "/usr/bin/sample");
  assert.ok(f.calls.every(call => call.options.signal.aborted));
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
