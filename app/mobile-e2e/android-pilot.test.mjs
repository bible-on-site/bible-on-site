import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { ownedTestEmulatorProcesses, runAndroidPilot, terminateAndroidTestEmulator } from "./android-pilot.mjs";

const emulator = (pid = 123, avd = "mobile_e2e", port = "5554") => ({ pid, ppid: 10, state: "S",
  args: ["/sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64", "-avd", avd, "-port", port, "-no-snapshot-save"] });
const options = { avdName: "mobile_e2e", udid: "emulator-5554" };

test("cleanup owns only the exact disposable AVD/port and its descendants", () => {
  const root = emulator();
  const helper = { pid: 124, ppid: 123, state: "S", args: ["/sdk/emulator/crashpad_handler"] };
  const grandchild = { pid: 125, ppid: 124, state: "S", args: ["/sdk/emulator/netsimd"] };
  const unrelated = [emulator(200, "mobile_e2e_other"), emulator(201, "mobile_e2e", "5556"),
    { pid: 300, ppid: 10, state: "S", args: ["node", "mobile_e2e"] }];
  assert.deepEqual(ownedTestEmulatorProcesses([grandchild, root, helper, ...unrelated], "mobile_e2e", "emulator-5554").map(x => x.pid), [125, 123, 124]);
  assert.throws(() => ownedTestEmulatorProcesses([{ ...root, args: root.args.filter(x => x !== "-no-snapshot-save") }], "mobile_e2e", "emulator-5554"), /snapshot-producing/);
  assert.throws(() => ownedTestEmulatorProcesses([root], "", "emulator-5554"), /explicit/);
});

test("an emulator that ignores graceful shutdown and holds output pipes is killed with its helpers", async () => {
  let records = [emulator(), { pid: 124, ppid: 123, state: "S", args: ["crashpad_handler"] }];
  const signals = [];
  const result = await terminateAndroidTestEmulator({ ...options, list: async () => records,
    signal: (pid, signal) => { signals.push([pid, signal]); records = records.filter(record => record.pid !== pid); } });
  assert.deepEqual(signals, [[123, "SIGKILL"], [124, "SIGKILL"]]);
  assert.equal(result.status, "terminated");
  assert.deepEqual(result.pids, [123, 124]);
});

test("cleanup accepts exited/zombie processes and bounds a kernel process that cannot exit", async () => {
  const already = await terminateAndroidTestEmulator({ ...options, list: async () => [], signal: () => assert.fail() });
  assert.equal(already.status, "already-stopped");
  let zombie = false;
  await terminateAndroidTestEmulator({ ...options, list: async () => [{ ...emulator(), state: zombie ? "Z" : "S" }], signal: () => { zombie = true; } });
  let clock = 0;
  await assert.rejects(terminateAndroidTestEmulator({ ...options, list: async () => [emulator()],
    signal: () => {}, sleep: async () => { clock += 50; }, now: () => clock }), /five seconds/);
  assert.equal(clock, 5000);
});

test("cleanup transport/permission failures are fatal and test failure codes are retained", async () => {
  await assert.rejects(terminateAndroidTestEmulator({ ...options, list: async () => { throw new Error("cannot read processes"); } }), /cannot read/);
  await assert.rejects(terminateAndroidTestEmulator({ ...options, list: async () => [emulator()], signal: () => { throw new Error("permission denied"); } }), /permission/);
  const records = [];
  for (const code of [0, 7, 124]) {
    assert.equal(await runAndroidPilot({ run: async () => code, cleanup: async () => ({ status: "terminated" }), record: result => records.push(result) }), code);
  }
  assert.equal(records.length, 3);
  assert.equal(await runAndroidPilot({ run: async () => 0, cleanup: async () => { throw new Error("cleanup failed"); } }), 1);
  let cleaned = false;
  await assert.rejects(runAndroidPilot({ run: async () => { throw new Error("spawn failed"); }, cleanup: async () => { cleaned = true; } }), /spawn failed/);
  assert.equal(cleaned, true);
});

test("real Linux cleanup closes pipes held by a graceful-shutdown-resistant emulator and descendant", { skip: process.platform !== "linux" }, async t => {
  const fixture = `const {spawn}=require("node:child_process");
    const helper=spawn(process.execPath,["-e","process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:["ignore","inherit","inherit"]});
    process.on("SIGTERM",()=>{});console.log(helper.pid);setInterval(()=>{},1000);`;
  const root = spawn(process.execPath, ["-e", fixture, "--", "-avd", "mobile_e2e", "-port", "5554", "-no-snapshot-save"],
    { argv0: "/sdk/emulator/qemu-system-x86_64", stdio: ["ignore", "pipe", "pipe"] });
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "--", "-avd", "mobile_e2e_other", "-port", "5554", "-no-snapshot-save"],
    { argv0: "/sdk/emulator/qemu-system-x86_64", stdio: "ignore" });
  let helperPid;
  t.after(() => {
    for (const pid of [root.pid, helperPid, unrelated.pid].filter(Boolean)) {
      try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  });
  const [ready] = await once(root.stdout, "data", { signal: AbortSignal.timeout(5000) });
  helperPid = Number(ready.toString().trim());
  assert.ok(helperPid > 1);
  const closed = once(root.stdout, "close", { signal: AbortSignal.timeout(5000) });
  const result = await terminateAndroidTestEmulator(options);
  await closed;
  assert.equal(result.status, "terminated");
  assert.deepEqual(new Set(result.pids), new Set([root.pid, helperPid]));
  assert.equal(process.kill(unrelated.pid, 0), true);
});
