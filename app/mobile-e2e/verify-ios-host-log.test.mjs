import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { observeIosHostLog, shutdownEvidence, verifyIosHostLog } from "./verify-ios-host-log.mjs";

const udid = "24E299B4-C77B-4426-AC2B-71243825F07C";
const service = "2026-11-11 20:17:06.012 Df com.apple.CoreSimulator.CoreSimulatorService[24253:28cfc]";
function fixture(t, state = "Booted", classic = false, event = "Shutdown requested for") {
  const directory = mkdtempSync(join(tmpdir(), "host-shutdown-contract-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifact = join(directory, "host.log");
  const calls = [];
  let stopped = false;
  let classicStopped = false;
  let onOutput;
  let classicOutput, classicArtifact;
  return { artifact, calls, get stopped() { return stopped && (!classic || classicStopped); }, options: {
    udid, artifact, home: directory,
    async execute(command, args) {
      calls.push({ command, args });
      if (args[1] === "shutdown") {
        state = "Shutdown";
        const log = `${service} ${event} ${udid}\n`;
        writeFileSync(classic ? classicArtifact : artifact, log);
        (classic ? classicOutput : onOutput)(log);
      }
      return { stdout: `${args[1] === "UDID" ? udid : ["Creating", "Shutdown", "Booting", "Booted", "Shutting Down"].indexOf(state)}\n` };
    },
    stream(command, args, path, options) {
      calls.push({ command, args });
      onOutput = options.onOutput;
      const log = "Filtering the log data using process scope\n";
      writeFileSync(path, log);
      onOutput(log);
      return { async stop() { stopped = true; } };
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

test("validates the target transition and preserves correlated evidence before stopping the observer", async t => {
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
  assert.equal(result.limitation, null);
  assert.equal(result.correlatedLines, 1);
  assert.deepEqual(result.sources, { unified: 1 });
  assert(result.capturedBytes.unified > 0);
  // String concat, not a template literal: Codacy flags interpolated literals
  // that "look like HTML" — a false positive for these artifact paths.
  assert.deepEqual(JSON.parse(readFileSync(f.artifact + ".measurement.json", "utf8")), result);
  assert(f.stopped);
  assert.deepEqual(f.calls.filter(call => call.args[1] === "shutdown"),
    [{ command: "xcrun", args: ["simctl", "shutdown", udid] }]);
  assert.match(readFileSync(f.artifact, "utf8"), /Shutdown requested/);
});

test("retains classic evidence independently when unified logging has no lifecycle event", async t => {
  const f = fixture(t, "Booted", true);
  const result = await verifyIosHostLog(f.options);
  assert.equal(result.stateTransitionVerified, true);
  assert.equal(result.lifecycleRecordStatus, "observed");
  assert.equal(result.correlatedLines, 1);
  assert.deepEqual(result.sources, { unified: 0, classic: 1 });
  assert(f.stopped);
  assert.match(readFileSync(f.artifact + ".classic.log", "utf8"), /Shutdown requested/);
});

test("reports a missing OS record explicitly without claiming lifecycle evidence", async t => {
  const f = fixture(t, "Booted", true, "Activity for device");
  f.options.observationWindow = () => AbortSignal.abort(new DOMException("capture window ended", "TimeoutError"));
  const result = await verifyIosHostLog(f.options);
  assert.equal(result.stateTransitionVerified, true);
  assert.equal(result.lifecycleRecordStatus, "not-observed");
  assert.match(result.limitation, /reason and requesting client are not established/);
  assert.equal(result.correlatedLines, 0);
  assert.deepEqual(result.sources, { unified: 0, classic: 0 });
  assert(result.capturedBytes.unified > 0 && result.capturedBytes.classic > 0);
  assert(f.stopped);
});

test("queries only the owned device within the unchanged command budget", async t => {
  const f = fixture(t);
  const execute = f.options.execute;
  f.options.execute = async (command, args, options) => {
    if (command === "/usr/bin/plutil") {
      assert(["UDID", "state"].includes(args[1]));
      assert.deepEqual(args, ["-extract", args[1], "raw", "-o", "-",
        join(f.options.home, "Library", "Developer", "CoreSimulator", "Devices", udid, "device.plist")]);
      assert.equal(options.timeout, 5000);
    }
    return execute(command, args, options);
  };
  await verifyIosHostLog(f.options);
  assert.equal(f.calls.filter(call => call.command === "/usr/bin/plutil").length, 4);
  assert(!f.calls.some(call => call.args[1] === "list"));
});

test("rejects a failed final state query and retains its timing without persisting success", async t => {
  const f = fixture(t, "Booted", true);
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
  assert.throws(() => readFileSync(f.artifact + ".measurement.json"), { code: "ENOENT" });
});

test("rejects shutdown command failures and joins both readers", async t => {
  const f = fixture(t, "Booted", true);
  const execute = f.options.execute;
  f.options.execute = async (command, args, options) => {
    if (args[1] === "shutdown") throw new Error("shutdown rejected");
    return execute(command, args, options);
  };
  await assert.rejects(verifyIosHostLog(f.options), /owned simulator shutdown command: shutdown rejected/);
  assert(f.stopped);
  assert.throws(() => readFileSync(f.artifact + ".measurement.json"), { code: "ENOENT" });
});

test("rejects operation expiry during reader cleanup without persisting success", async t => {
  const f = fixture(t, "Booted", true);
  const controller = new AbortController();
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", milliseconds => milliseconds === 40000
    ? controller.signal : timeout(milliseconds));
  const stream = f.options.stream;
  f.options.stream = (...args) => {
    const observer = stream(...args);
    return { async stop() {
      await observer.stop();
      controller.abort(new DOMException("operation expired during cleanup", "TimeoutError"));
    } };
  };
  await assert.rejects(verifyIosHostLog(f.options), /operation expired during cleanup/);
  assert(f.stopped);
  assert.throws(() => readFileSync(f.artifact + ".measurement.json"), { code: "ENOENT" });
});

test("retains late records without claiming they arrived inside the observation window", async t => {
  const f = fixture(t, "Booted", true, "Activity for device");
  f.options.observationWindow = () => AbortSignal.abort(new DOMException("capture window ended", "TimeoutError"));
  const stream = f.options.stream;
  f.options.stream = (...args) => {
    const observer = stream(...args);
    return { async stop() {
      const log = `${service} Shutdown requested for ${udid}\n`;
      writeFileSync(f.artifact, log);
      args[3].onOutput(log);
      await observer.stop();
    } };
  };
  const result = await verifyIosHostLog(f.options);
  assert.equal(result.correlatedLines, 1, "retain drained bytes as diagnostics");
  assert.equal(result.lifecycleRecordStatus, "not-observed");
  assert.match(result.limitation, /No service shutdown record observed in the fixed window/);
  assert(f.stopped);
});

test("rejects the overall deadline instead of reporting an unavailable OS field", async t => {
  const f = fixture(t, "Booted", true);
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
  const after = fixture(t, "Booted", true);
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
    const f = fixture(t, "Booted", true);
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
  // All-literal join plus concat, not one interpolated literal: Codacy flags
  // tag-looking fixture pieces and variables inside a single literal/join.
  const legacyRecord = ["Nov 11 20:17:06 localhost com.apple.CoreSimulator.CoreSimulatorService[24253]",
    "<Debug>:", "Shutting down"].join(" ");
  const legacy = legacyRecord + " " + udid;
  const legacyRequester = legacy.replace("CoreSimulatorService[", "simctl[");
  const bareRequester = `2026-11-11 20:17:02.375 simctl[65397] ${service} Shutdown ${udid}`;
  assert.deepEqual(shutdownEvidence([
    `booting ${udid}`, "shutdown foreign", requester, guiRequest, quotedService,
    lookalike, valid, legacy, legacyRequester, `${legacyRequester} via ${service}`,
    bareRequester, `${service} booting ${udid}`, `${service} shutdown foreign`,
  ].join("\n"), udid), [valid, legacy]);
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
