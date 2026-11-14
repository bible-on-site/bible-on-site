import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { clientRecords, observeIosHostLog, shutdownEvidence, udidRecords, verifyIosHostLog } from "./verify-ios-host-log.mjs";

const udid = "24E299B4-C77B-4426-AC2B-71243825F07C";
const service = "2026-11-11 20:17:06.012 Df com.apple.CoreSimulator.CoreSimulatorService[24253:28cfc]";
// eventSource picks which owned stream emits the shutdown record: a stream
// index (0 unified, 1 debug, 2 device), "classic", or "posthoc".
function fixture(t, state = "Booted", { classic = false, event = "Shutdown requested for",
  eventSource = 0, deviceLog = false, posthocLog = "" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "host-shutdown-contract-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifact = join(directory, "host.log");
  const calls = [];
  const streams = [];
  const outputs = [];
  let classicStopped = false;
  let classicOutput, classicArtifact;
  if (deviceLog) {
    mkdirSync(join(directory, "Library", "Logs", "CoreSimulator", udid), { recursive: true });
    writeFileSync(join(directory, "Library", "Logs", "CoreSimulator", udid, "system.log"), "historical\n");
  }
  // The record lands in the emitting source's artifact too: stream readers
  // persist their own file before the observer callback sees the chunk.
  const eventArtifacts = { 0: artifact, 1: `${artifact}.debug.log`, 2: `${artifact}.device.log` };
  const emit = log => {
    if (eventSource === "classic") {
      writeFileSync(classicArtifact, log);
      classicOutput(log);
    } else if (eventSource !== "posthoc") {
      writeFileSync(eventArtifacts[eventSource], log);
      outputs[eventSource]?.(log);
    }
  };
  return { artifact, calls, streams,
    get stopped() {
      return streams.length > 0 && streams.every(observer => observer.stopped)
        && (!classic || classicStopped);
    }, options: {
    udid, artifact, home: directory,
    async execute(command, args) {
      calls.push({ command, args });
      if (command === "/usr/bin/sw_vers") return { stdout: "ProductName: macOS\nProductVersion: 26.0.1\nBuildVersion: 25A362\n" };
      if (command === "/usr/bin/xcodebuild") return { stdout: "Xcode 27.0.1\nBuild version 17A400\n" };
      if (command === "/usr/bin/sudo") return { stdout: "" };
      if (args[0] === "show") {
        const log = eventSource === "posthoc" ? `${service} ${event} ${udid}\n` : posthocLog;
        return { stdout: log };
      }
      if (args[1] === "runtime") return { stdout: "com.apple.CoreSimulator.SimRuntime.iOS-27-0\n" };
      if (args[1] === "shutdown") {
        state = "Shutdown";
        emit(`${service} ${event} ${udid}\n`);
      }
      return { stdout: `${args[1] === "UDID" ? udid : ["Creating", "Shutdown", "Booting", "Booted", "Shutting Down"].indexOf(state)}\n` };
    },
    stream(command, args, path, options) {
      calls.push({ command, args });
      const log = "Filtering the log data using process scope\n";
      writeFileSync(path, log);
      outputs.push(options?.onOutput);
      options?.onOutput?.(log);
      const observer = { stopped: false, async stop() { observer.stopped = true; } };
      streams.push(observer);
      return observer;
    },
    classicStream(path, options) {
      if (!classic) return undefined;
      classicArtifact = path;
      classicOutput = options.onOutput;
      writeFileSync(path, "");
      return { async stop() { classicStopped = true; } };
    },
  } };
}

test("validates the target transition and preserves correlated evidence before stopping the observers", async t => {
  const f = fixture(t);
  const result = await verifyIosHostLog(f.options);
  assert.equal(result.udid, udid);
  assert.equal(result.stateTransitionVerified, true);
  assert.equal(result.before.state, "Booted");
  assert.equal(result.after.state, "Shutdown");
  assert.equal(result.before.numericState, 3);
  assert.equal(result.after.numericState, 1);
  assert.equal(result.before.source, join(f.options.home, "Library", "Developer", "CoreSimulator", "Devices", udid, "device.plist"));
  assert(Number.isFinite(Date.parse(result.before.at)));
  assert(Number.isFinite(Date.parse(result.after.at)));
  assert.deepEqual(result.request.args, ["simctl", "shutdown", udid]);
  assert.equal(result.request.pid, null, "the injected command has no real child PID");
  assert.equal(result.stateQueries.length, 4);
  assert(result.stateQueries.every(query => query.elapsedMs >= 0));
  assert(Number.isFinite(Date.parse(result.observation.startedAt)));
  assert(Number.isFinite(Date.parse(result.observation.endedAt)));
  assert.equal(result.lifecycleRecordStatus, "observed");
  assert.equal(result.collectionGap, false);
  assert.equal(result.limitation, null);
  assert.equal(result.correlatedLines, 1);
  assert.deepEqual(result.sources, { unified: 1, debug: 0, posthoc: 0 });
  assert.equal(result.capturedBytes.unified > 0, true);
  assert.equal(result.capturedBytes.debug > 0, true);
  assert.equal(result.environment.swVers.status, "captured");
  assert.match(result.environment.swVers.stdout, /ProductVersion: 26\.0\.1/);
  assert.match(result.environment.xcode.stdout, /Xcode 27\.0\.1/);
  assert.match(result.environment.deviceRuntime.stdout, /SimRuntime\.iOS-27-0/);
  assert.equal(result.debugPersistence.status, "captured");
  assert.equal(result.debugPersistence.restored, true);
  assert.equal(result.posthoc.status, "captured");
  assert.equal(result.posthoc.stdoutBytes, 0);
  assert.deepEqual(JSON.parse(readFileSync(`${f.artifact}.measurement.json`, "utf8")), result);
  assert(f.stopped);
  assert.deepEqual(f.calls.filter(call => call.args[1] === "shutdown"),
    [{ command: "xcrun", args: ["simctl", "shutdown", udid] }]);
  assert.match(readFileSync(f.artifact, "utf8"), /Shutdown requested/);
});

test("retains classic evidence independently when unified logging has no lifecycle event", async t => {
  const f = fixture(t, "Booted", { classic: true, eventSource: "classic" });
  const result = await verifyIosHostLog(f.options);
  assert.equal(result.stateTransitionVerified, true);
  assert.equal(result.lifecycleRecordStatus, "observed");
  assert.equal(result.correlatedLines, 1);
  assert.deepEqual(result.sources, { unified: 0, debug: 0, classic: 1, posthoc: 0 });
  assert(f.stopped);
  assert.match(readFileSync(`${f.artifact}.classic.log`, "utf8"), /Shutdown requested/);
});

test("flags a collection gap when only the debug probe retains the record", async t => {
  const f = fixture(t, "Booted", { eventSource: 1 });
  const result = await verifyIosHostLog(f.options);
  assert.equal(result.lifecycleRecordStatus, "observed");
  assert.deepEqual(result.sources, { unified: 0, debug: 1, posthoc: 0 });
  assert.equal(result.correlatedLines, 1);
  assert.equal(result.collectionGap, true);
  assert.match(result.limitation, /collection correction is required/);
  assert.equal(result.samples.shutdown.length, 1);
  assert(f.stopped);
});

test("flags a collection gap when only the post-hoc sweep retains the record", async t => {
  const f = fixture(t, "Booted", { eventSource: "posthoc" });
  f.options.observationWindow = () => AbortSignal.abort(new DOMException("capture window ended", "TimeoutError"));
  const result = await verifyIosHostLog(f.options);
  assert.equal(result.lifecycleRecordStatus, "after-window",
    "a post-hoc record outside the window is still outside the window");
  assert.deepEqual(result.sources, { unified: 0, debug: 0, posthoc: 1 });
  assert.equal(result.collectionGap, true);
  assert.match(result.limitation, /out-of-window bytes retain one/);
  assert(f.stopped);
});

test("bounds the persisted-store query to the controlled window", async t => {
  const f = fixture(t);
  await verifyIosHostLog(f.options);
  const show = f.calls.find(call => call.args[0] === "show");
  assert(show, "the post-hoc sweep runs");
  const last = Number(show.args[show.args.indexOf("--last") + 1].replace("s", ""));
  assert(last <= 30,
    "an earlier shutdown of the same device cannot reach the evidence count");
});

test("stops the attached reader when a later stream fails to attach", async t => {
  const f = fixture(t);
  const stream = f.options.stream;
  let attachments = 0;
  f.options.stream = (...args) => {
    attachments += 1;
    if (attachments === 2) throw new Error("debug artifact is a directory");
    return stream(...args);
  };
  await assert.rejects(verifyIosHostLog(f.options), /debug artifact is a directory/);
  assert(f.stopped, "the already-running info reader must not leak");
});

test("restores debug persistence under cancellation on its own budget", async t => {
  const f = fixture(t);
  const controller = new AbortController();
  f.options.signal = controller.signal;
  const execute = f.options.execute;
  f.options.execute = async (command, args, options) => {
    assert(!options?.signal?.aborted || args.includes("--reset"),
      "only the independent reset budget may outlive cancellation");
    return execute(command, args, options);
  };
  const stream = f.options.stream;
  f.options.stream = (...args) => {
    const observer = stream(...args);
    return { async stop() {
      await observer.stop();
      controller.abort(new DOMException("cancelled during cleanup", "AbortError"));
    } };
  };
  await assert.rejects(verifyIosHostLog(f.options), /cancelled during cleanup/);
  assert(f.calls.some(call => call.args.includes("--reset")),
    "the enabled persistence is still reset after cancellation");
});

test("reports a missing OS record explicitly without claiming lifecycle evidence", async t => {
  const f = fixture(t, "Booted", { classic: true, event: "Activity for device", eventSource: "classic" });
  f.options.observationWindow = () => AbortSignal.abort(new DOMException("capture window ended", "TimeoutError"));
  const result = await verifyIosHostLog(f.options);
  assert.equal(result.stateTransitionVerified, true);
  assert.equal(result.lifecycleRecordStatus, "not-observed");
  assert.match(result.limitation, /reason and requesting client are not established/);
  assert.equal(result.correlatedLines, 0);
  assert.deepEqual(result.sources, { unified: 0, debug: 0, classic: 0, posthoc: 0 });
  assert(result.capturedBytes.unified > 0 && result.capturedBytes.classic > 0);
  assert.equal(result.udidCorrelated.classic, 1,
    "the device-named context line is retained as context, not claimed as evidence");
  assert(f.stopped);
});

test("tails the device system log when the image still persists one", async t => {
  const f = fixture(t, "Booted", { deviceLog: true, eventSource: 2 });
  const result = await verifyIosHostLog(f.options);
  assert.equal(result.environment.deviceLog.offset, "historical\n".length);
  assert.equal(result.lifecycleRecordStatus, "observed");
  assert.equal(result.sources.device, 1);
  assert.equal(result.collectionGap, true);
  assert(f.stopped);
});

test("records a missing device system log without launching its reader", async t => {
  const f = fixture(t);
  const result = await verifyIosHostLog(f.options);
  assert.equal(result.environment.deviceLog.offset, null);
  assert.equal("device" in result.sources, false);
  assert.equal(result.streams, undefined);
});

test("queries only the owned device within the unchanged command budget", async t => {
  const f = fixture(t);
  const execute = f.options.execute;
  f.options.execute = async (command, args, options) => {
    if (command === "/usr/bin/plutil") {
      assert(["UDID", "state", "runtime"].includes(args[1]));
      assert.deepEqual(args, ["-extract", args[1], "raw", "-o", "-",
        join(f.options.home, "Library", "Developer", "CoreSimulator", "Devices", udid, "device.plist")]);
      assert.equal(options.timeout, 5000);
    }
    return execute(command, args, options);
  };
  await verifyIosHostLog(f.options);
  assert.equal(f.calls.filter(call => call.command === "/usr/bin/plutil").length, 5);
  assert(!f.calls.some(call => call.args[1] === "list"));
});

test("rejects a failed final state query and retains its timing without persisting success", async t => {
  const f = fixture(t, "Booted", { classic: true });
  const execute = f.options.execute;
  const reports = [];
  let queries = 0;
  f.options.report = report => reports.push(report);
  f.options.execute = async (command, args, options) => {
    if (args[1] === "state" && ++queries === 2) throw new Error("state query exceeded five seconds");
    return execute(command, args, options);
  };
  await assert.rejects(verifyIosHostLog(f.options), /shutdown state verification: state query exceeded five seconds/);
  const timings = reports.filter(report => report.stage === "target state query");
  assert.equal(timings.length, 4);
  assert(timings.every(report => report.elapsedMs >= 0));
  assert(f.stopped);
  assert.throws(() => readFileSync(`${f.artifact}.measurement.json`), { code: "ENOENT" });
});

test("rejects shutdown command failures and joins every reader", async t => {
  const f = fixture(t, "Booted", { classic: true });
  const execute = f.options.execute;
  f.options.execute = async (command, args, options) => {
    if (args[1] === "shutdown") throw new Error("shutdown rejected");
    return execute(command, args, options);
  };
  await assert.rejects(verifyIosHostLog(f.options), /owned simulator shutdown command: shutdown rejected/);
  assert(f.stopped);
  assert.throws(() => readFileSync(`${f.artifact}.measurement.json`), { code: "ENOENT" });
});

test("rejects operation expiry during reader cleanup without persisting success", async t => {
  const f = fixture(t, "Booted", { classic: true });
  const controller = new AbortController();
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", milliseconds => milliseconds === 60000
    ? controller.signal : timeout(milliseconds));
  const stream = f.options.stream;
  let wrapped = 0;
  f.options.stream = (...args) => {
    const observer = stream(...args);
    return { async stop() {
      await observer.stop();
      if (++wrapped === f.streams.length) {
        controller.abort(new DOMException("operation expired during cleanup", "TimeoutError"));
      }
    } };
  };
  await assert.rejects(verifyIosHostLog(f.options), /operation expired during cleanup/);
  assert(f.stopped);
  assert.throws(() => readFileSync(`${f.artifact}.measurement.json`), { code: "ENOENT" });
});

test("retains late records without claiming they arrived inside the observation window", async t => {
  const f = fixture(t, "Booted", { classic: true, event: "Activity for device" });
  f.options.observationWindow = () => AbortSignal.abort(new DOMException("capture window ended", "TimeoutError"));
  const stream = f.options.stream;
  let first = true;
  f.options.stream = (...args) => {
    const observer = stream(...args);
    if (!first) return observer;
    first = false;
    return { async stop() {
      const log = `${service} Shutdown requested for ${udid}\n`;
      writeFileSync(f.artifact, log);
      args[3].onOutput(log);
      await observer.stop();
    } };
  };
  const result = await verifyIosHostLog(f.options);
  assert.equal(result.correlatedLines, 1, "retain drained bytes as diagnostics");
  assert.equal(result.lifecycleRecordStatus, "after-window");
  assert.match(result.limitation, /out-of-window bytes retain one/);
  assert(f.stopped);
});

test("rejects the overall deadline instead of reporting an unavailable OS field", async t => {
  const f = fixture(t);
  const controller = new AbortController();
  f.options.signal = controller.signal;
  f.options.observe = () => ({ write() {}, async waitFor(stage) {
    if (stage !== "shutdown") return;
    controller.abort(new DOMException("overall deadline", "TimeoutError"));
    throw controller.signal.reason;
  } });
  await assert.rejects(verifyIosHostLog(f.options), /overall deadline/);
  assert(f.stopped);
});

test("rejects cancellation before commands or during reader cleanup", async t => {
  const before = fixture(t);
  before.options.signal = AbortSignal.abort(new DOMException("cancelled", "AbortError"));
  await assert.rejects(verifyIosHostLog(before.options), /cancelled/);
  assert.equal(before.calls.length, 0);
  const after = fixture(t, "Booted", { classic: true });
  const controller = new AbortController();
  after.options.signal = controller.signal;
  const stream = after.options.stream;
  after.options.stream = (...args) => {
    const observer = stream(...args);
    return { async stop() {
      await observer.stop();
      controller.abort(new DOMException("cancelled during cleanup", "AbortError"));
    } };
  };
  await assert.rejects(verifyIosHostLog(after.options), /cancelled during cleanup/);
  assert(after.stopped);
});

test("refuses an absent or already stopped target without starting an observer or shutting another device down", async t => {
  for (const state of [undefined, "Shutdown"]) {
    const f = fixture(t, state);
    if (state === undefined) f.options.execute = async () => ({ stdout: '{"devices":{}}' });
    await assert.rejects(verifyIosHostLog(f.options), /Refuse shutdown/);
    assert(!f.stopped);
    assert(f.calls.every(call => call.args[1] !== "shutdown"));
  }
  await assert.rejects(verifyIosHostLog({ udid: "booted" }), /match/);
});

test("rejects foreign, malformed and transitional persisted state before issuing shutdown", async t => {
  for (const [identity, numeric] of [["foreign", "3"], [udid, "3 trailing"], [udid, "3\nextra"],
    [udid, "0"], [udid, "2"], [udid, "4"]]) {
    const f = fixture(t);
    f.options.execute = async (command, args) => ({ stdout: args[1] === "UDID" ? identity : numeric });
    await assert.rejects(verifyIosHostLog(f.options), /Refuse shutdown/);
    assert.equal(f.calls.length, 0);
  }
});

test("joins the other bounded plist read before reporting a read failure", async t => {
  const f = fixture(t);
  let finishIdentity;
  f.options.execute = async (command, args) => {
    if (args[1] === "state") throw new Error("state read failed");
    return new Promise(resolve => { finishIdentity = () => resolve({ stdout: udid }); });
  };
  let rejected = false;
  const pending = verifyIosHostLog(f.options).catch(error => { rejected = true; throw error; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rejected, false, "the owned identity read must still be joined");
  finishIdentity();
  await assert.rejects(pending, /state read failed/);
  assert.equal(f.calls.length, 0);
});

test("closes the owned host observer when startup or shutdown observation fails", async t => {
  for (const failureAt of [1, 2]) {
    const f = fixture(t, "Booted", { classic: true });
    const stages = [];
    f.options.report = event => stages.push(event);
    let observations = 0;
    f.options.observe = () => ({ write() {},
      async waitFor() { if (++observations === failureAt) throw new Error("evidence absent"); } });
    await assert.rejects(verifyIosHostLog(f.options), error => {
      assert.match(error.message, failureAt === 1 ? /host logger startup/ : /observe service shutdown record/);
      assert.equal(error.cause.message, "evidence absent");
      return true;
    });
    assert.equal(stages.at(-1).udid, udid);
    assert(Number.isFinite(Date.parse(stages.at(-1).at)));
    assert(f.stopped);
    assert.equal(f.calls.filter(call => call.args[1] === "shutdown").length, failureAt - 1);
  }
});

test("requires the lifecycle emitter, device identity and shutdown event", () => {
  const valid = `${service} Shutting down ${udid.toLowerCase()}`;
  const requester = `2026-11-11 20:17:02.375 Df simctl[65397:1b938] Shutdown requested for ${udid}`;
  const guiRequest = requester.replace("simctl[", "Simulator[");
  const quotedService = `${requester} via ${service}`;
  const lookalike = valid.replace("CoreSimulatorService[", "CoreSimulatorServiceHelper[");
  const legacy = ["Nov 11 20:17:06 localhost com.apple.CoreSimulator.CoreSimulatorService[24253]",
    "<Debug>:", "Shutting down", udid].join(" ");
  const legacyRequester = legacy.replace("CoreSimulatorService[", "simctl[");
  const bareRequester = `2026-11-11 20:17:02.375 simctl[65397] ${service} Shutdown ${udid}`;
  assert.deepEqual(shutdownEvidence([
    `booting ${udid}`, "shutdown foreign", requester, guiRequest, quotedService,
    lookalike, valid, legacy, legacyRequester, `${legacyRequester} via ${service}`,
    bareRequester, `${service} booting ${udid}`, `${service} shutdown foreign`,
  ].join("\n"), udid), [valid, legacy]);
});

test("correlates device-named and client-pid records without claiming them as shutdown evidence", () => {
  const pid = 37166;
  const log = [
    `2026-11-12 21:06:17.076 Df com.apple.CoreSimulator.CoreSimulatorService[6532:1868e] Failed to get a device identity for simulator device ${udid}, error: MobileActivation`,
    "2026-11-12 21:06:18.370 Df com.apple.CoreSimulator.CoreSimulatorService[6532:18c4e] [com.apple.xpc:connection] activating connection: peer=true name=com.apple.CoreSimulator.CoreSimulatorService.peer[37166].0x783532b340",
    "Nov 12 21:06:19 runner com.apple.CoreSimulator.simctl[37166] <Notice>: Connecting to com.apple.CoreSimulator.SimLaunchHost-arm64",
    "Nov 12 21:06:19 runner com.apple.CoreSimulator.simctl[137166] <Notice>: a different client pid must not match",
    `Nov 12 21:06:20 runner CoreSimulatorService[6532] <Debug>: Shutting down ${udid}`,
  ].join("\n");
  assert.equal(shutdownEvidence(log, udid).length, 1);
  assert.equal(udidRecords(log, udid).length, 2);
  assert.deepEqual(clientRecords(log, pid).length, 2);
  assert.deepEqual(clientRecords(log, null), []);
  assert.deepEqual(clientRecords("nothing", undefined), []);
});

test("waits for every piped source's startup marker before issuing the shutdown", async () => {
  const evidence = observeIosHostLog(udid, { startupSources: ["unified", "debug"] });
  evidence.write("Filtering the log data using process scope\n", "unified");
  const pending = evidence.waitFor("startup", AbortSignal.timeout(5000));
  const settled = Promise.race([pending.then(() => "resolved"), new Promise(resolve =>
    setImmediate(() => resolve("pending")))]);
  assert.equal(await settled, "pending", "one source's marker must not open the shutdown window");
  evidence.write("Filtering the log data using debug scope\n", "debug");
  await pending;
});

test("retains early and split pipe writes, unrelated events and cancellation without polling", async () => {
  const evidence = observeIosHostLog(udid);
  evidence.write("Filtering the log data using process scope\n");
  await evidence.waitFor("startup", AbortSignal.timeout(5000));
  const pending = evidence.waitFor("shutdown", AbortSignal.timeout(5000));
  evidence.write("shutdown foreign\nbooting " + udid + `\n${service} Shutting do`);
  evidence.write("wn " + udid + "\n");
  await pending;
  await evidence.waitFor("shutdown", AbortSignal.timeout(5000));
  const abort = new AbortController();
  const canceled = observeIosHostLog(udid).waitFor("shutdown", abort.signal);
  abort.abort(new Error("canceled"));
  await assert.rejects(canceled, /canceled/);
  await assert.rejects(evidence.waitFor("shutdown", abort.signal), /canceled/);
});

test("observes complete startup or shutdown records without a trailing newline", async () => {
  const evidence = observeIosHostLog(udid);
  evidence.write("Filtering the log data using process scope");
  await evidence.waitFor("startup", AbortSignal.timeout(5000));
  evidence.write(`\n${service} Shutdown requested for ` + udid.slice(0, 16));
  const pending = evidence.waitFor("shutdown", AbortSignal.timeout(5000));
  evidence.write(udid.slice(16));
  await pending;
});

test("keeps fragmented records in separate buffers for interleaved host readers", async () => {
  const evidence = observeIosHostLog(udid);
  evidence.write(`${service} Shutting do`, "unified");
  evidence.write("Nov 11 20:17:06 localhost simctl[65397] unrelated", "classic");
  const pending = evidence.waitFor("shutdown", AbortSignal.timeout(5000));
  evidence.write(`wn ${udid}`, "unified");
  await pending;
});
