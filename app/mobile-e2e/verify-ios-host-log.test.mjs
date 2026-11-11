import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { observeIosHostLog, shutdownEvidence, verifyIosHostLog } from "./verify-ios-host-log.mjs";

const udid = "24E299B4-C77B-4426-AC2B-71243825F07C";
function fixture(t, state = "Booted") {
  const directory = mkdtempSync(join(tmpdir(), "host-shutdown-contract-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifact = join(directory, "host.log");
  const calls = [];
  let stopped = false;
  let onOutput;
  return { artifact, calls, get stopped() { return stopped; }, options: {
    udid, artifact,
    async execute(command, args) {
      calls.push({ command, args });
      if (args[1] === "shutdown") {
        state = "Shutdown";
        const log = `CoreSimulatorService: Shutdown requested for ${udid}\n`;
        writeFileSync(artifact, log);
        onOutput(log);
      }
      return { stdout: JSON.stringify({ devices: { ios: [{ udid: "foreign", state: "Booted" }, { udid, state }] } }) };
    },
    stream(command, args, path, options) {
      calls.push({ command, args });
      onOutput = options.onOutput;
      const log = "Filtering the log data using process scope\n";
      writeFileSync(path, log);
      onOutput(log);
      return { async stop() { stopped = true; } };
    },
  } };
}

test("validates the target transition and preserves correlated evidence before stopping the observer", async t => {
  const f = fixture(t);
  assert.deepEqual(await verifyIosHostLog(f.options), { udid, shutdownVerified: true, correlatedLines: 1 });
  assert(f.stopped);
  assert.deepEqual(f.calls.filter(call => call.args[1] === "shutdown"),
    [{ command: "xcrun", args: ["simctl", "shutdown", udid] }]);
  assert.match(readFileSync(f.artifact, "utf8"), /Shutdown requested/);
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

test("missing startup or shutdown evidence still closes the owned host observer", async t => {
  for (const failureAt of [1, 2]) {
    const f = fixture(t);
    const stages = [];
    f.options.report = event => stages.push(event);
    let observations = 0;
    f.options.observe = () => ({ write() {},
      async waitFor() { if (++observations === failureAt) throw new Error("evidence absent"); } });
    await assert.rejects(verifyIosHostLog(f.options), error => {
      assert.match(error.message, failureAt === 1 ? /host logger startup/ : /device-correlated host shutdown event/);
      assert.equal(error.cause.message, "evidence absent");
      return true;
    });
    assert.equal(stages.at(-1).udid, udid);
    assert(Number.isFinite(Date.parse(stages.at(-1).at)));
    assert(f.stopped);
    assert.equal(f.calls.filter(call => call.args[1] === "shutdown").length, failureAt - 1);
  }
});

test("shutdown evidence requires both this device identity and a shutdown event", () => {
  const valid = `CoreSimulatorService: Shutting down ${udid.toLowerCase()}`;
  assert.deepEqual(shutdownEvidence(`booting ${udid}\nshutdown foreign\n${valid}`, udid), [valid]);
});

test("pipe observation retains early and split writes, unrelated events and cancellation without polling", async () => {
  const evidence = observeIosHostLog(udid);
  evidence.write("Filtering the log data using process scope\n");
  await evidence.waitFor("startup", AbortSignal.timeout(5000));
  const pending = evidence.waitFor("shutdown", AbortSignal.timeout(5000));
  evidence.write("shutdown foreign\nbooting " + udid + "\nCoreSimulatorService: Shutting do");
  evidence.write("wn " + udid + "\n");
  await pending;
  await evidence.waitFor("shutdown", AbortSignal.timeout(5000));
  const abort = new AbortController();
  const canceled = observeIosHostLog(udid).waitFor("shutdown", abort.signal);
  abort.abort(new Error("canceled"));
  await assert.rejects(canceled, /canceled/);
  await assert.rejects(evidence.waitFor("shutdown", abort.signal), /canceled/);
});

test("a complete startup or shutdown record needs no trailing newline", async () => {
  const evidence = observeIosHostLog(udid);
  evidence.write("Filtering the log data using process scope");
  await evidence.waitFor("startup", AbortSignal.timeout(5000));
  evidence.write("\nCoreSimulatorService: Shutdown requested for " + udid.slice(0, 16));
  const pending = evidence.waitFor("shutdown", AbortSignal.timeout(5000));
  evidence.write(udid.slice(16));
  await pending;
});
