import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { shutdownEvidence, verifyIosHostLog, waitForLogEvidence } from "./verify-ios-host-log.mjs";

const udid = "24E299B4-C77B-4426-AC2B-71243825F07C";
function fixture(t, state = "Booted") {
  const directory = mkdtempSync(join(tmpdir(), "host-shutdown-contract-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifact = join(directory, "host.log");
  const calls = [];
  let stopped = false;
  return { artifact, calls, get stopped() { return stopped; }, options: {
    udid, artifact,
    async execute(command, args) {
      calls.push({ command, args });
      if (args[1] === "shutdown") {
        state = "Shutdown";
        writeFileSync(artifact, `CoreSimulatorService: Shutdown requested for ${udid}\n`);
      }
      return { stdout: JSON.stringify({ devices: { ios: [{ udid: "foreign", state: "Booted" }, { udid, state }] } }) };
    },
    stream(command, args, path) {
      calls.push({ command, args });
      writeFileSync(path, "Filtering the log data using process scope\n");
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
    let observations = 0;
    f.options.wait = async () => { if (++observations === failureAt) throw new Error("evidence absent"); };
    await assert.rejects(verifyIosHostLog(f.options), /evidence absent/);
    assert(f.stopped);
    assert.equal(f.calls.filter(call => call.args[1] === "shutdown").length, failureAt - 1);
  }
});

test("shutdown evidence requires both this device identity and a shutdown event", () => {
  const valid = `CoreSimulatorService: Shutting down ${udid.toLowerCase()}`;
  assert.deepEqual(shutdownEvidence(`booting ${udid}\nshutdown foreign\n${valid}`, udid), [valid]);
});

test("filesystem observation handles existing data, later writes and cancellation without polling", async t => {
  const f = fixture(t);
  writeFileSync(f.artifact, "ready");
  await waitForLogEvidence(f.artifact, log => log === "ready", AbortSignal.timeout(5000));
  const pending = waitForLogEvidence(f.artifact, log => log === "shutdown", AbortSignal.timeout(5000));
  writeFileSync(f.artifact, "shutdown");
  await pending;
  const abort = new AbortController();
  const canceled = waitForLogEvidence(f.artifact, () => false, abort.signal);
  abort.abort(new Error("canceled"));
  await assert.rejects(canceled, /canceled/);
  await assert.rejects(waitForLogEvidence(f.artifact, () => false, abort.signal), /canceled/);
  await assert.rejects(waitForLogEvidence(join(f.artifact, "missing"), () => false, AbortSignal.timeout(5000)));
});
