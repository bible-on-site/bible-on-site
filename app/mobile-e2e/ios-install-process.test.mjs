import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { test } from "node:test";
import { executeOwnedIosInstaller } from "./ios-install-process.mjs";

const posix = process.platform !== "win32";
const udid = "4AD2086B-7B8F-4608-A742-AA422A0B8D74", nonce = "b".repeat(32);
const options = () => ({ appPath: "/owned/BibleOnSite.app", udid, nonce, keepData: false,
  deadlineMs: Date.now() + 4000, environment: { ...process.env, CONTROLLED_SECRET: "never log this environment value" },
  signal: new AbortController().signal });
const fixture = script => (command, args, config) => {
  assert.equal(command, process.execPath);
  assert(args[0].endsWith("ios-install.mjs"));
  assert.equal(args[1], "/owned/BibleOnSite.app");
  assert.equal(args[2], udid);
  assert.equal(args[3], nonce);
  assert.equal(args[4], "reset");
  assert.equal(args[6], process.execPath);
  assert.equal(config.detached, true);
  return spawn(command, ["-e", script], config);
};
function assertStopped(pid) {
  try {
    const state = execFileSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8", timeout: 1000 }).trim();
    assert.match(state, /^[ZX]/, "The owned descendant must have exited, not remain runnable.");
  } catch (error) { if (error.status !== 1) throw error; }
}

test("an already cancelled request never starts another installer", async () => {
  const controller = new AbortController(), reason = new Error("original cancelled request");
  controller.abort(reason);
  await assert.rejects(executeOwnedIosInstaller({ ...options(), signal: controller.signal,
    launch: () => assert.fail("must not spawn") }), error => error === reason);
});

test("fixed installer uses the exact interpreter and joins exit and pipes without exposing environment", { skip: !posix, timeout: 5000 }, async () => {
  const records = [];
  const output = await executeOwnedIosInstaller({ ...options(), report: value => records.push(value),
    launch: fixture("process.stdout.write('controlled receipt')") });
  assert.equal(output, "controlled receipt");
  assert.equal(records.at(-1).phase, "installer-joined");
  assert.equal(records.filter(record => record.phase === "group-kill-starting").length, 1);
  assert(!JSON.stringify(records).includes("never log this environment value"));
});

test("nonzero installer exit preserves stderr and still joins its owned group", { skip: !posix, timeout: 5000 }, async () => {
  const records = [];
  await assert.rejects(executeOwnedIosInstaller({ ...options(), report: value => records.push(value),
    launch: fixture("process.stderr.write('controlled child failure');process.exitCode=7") }),
    error => error.code === 7 && error.stderr === "controlled child failure");
  assert.equal(records.at(-1).phase, "installer-joined");
});

test("deadline cancellation kills the exact group and joins a grandchild holding inherited pipes", { skip: !posix, timeout: 5000 }, async () => {
  const controller = new AbortController(), records = [];
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const grandchild = "process.stdout.write(JSON.stringify({ready:process.pid})+'\\n');setInterval(()=>{},1000)";
  const launch = fixture(`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'});setInterval(()=>{},1000)`);
  let buffered = "";
  const pending = executeOwnedIosInstaller({ ...options(), signal: controller.signal, report: value => records.push(value),
    launch: (...args) => {
      const child = launch(...args);
      child.stdout.on("data", chunk => {
        buffered += chunk;
        if (buffered.includes("\n")) resolveReady(JSON.parse(buffered.split("\n")[0]).ready);
      });
      return child;
    } });
  const descendant = await ready;
  const reason = new Error("original session deadline");
  const rejected = assert.rejects(pending, error => error === reason);
  controller.abort(reason);
  await rejected;
  assertStopped(descendant);
  assert.equal(records.at(-1).phase, "installer-joined");
  assert.equal(records.filter(record => record.phase === "group-kill-starting").length, 1);
});

test("natural parent exit also terminates a surviving descendant before reporting success", { skip: !posix, timeout: 5000 }, async () => {
  const script = "const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});process.stdout.write(String(child.pid));process.exit(0)";
  const output = await executeOwnedIosInstaller({ ...options(), launch: fixture(script) });
  assertStopped(Number(output));
});

test("an uncertain group signal cannot become success even after a zero exit", { skip: !posix, timeout: 5000 }, async () => {
  const failure = Object.assign(new Error("controlled ownership failure"), { code: "EPERM" });
  await assert.rejects(executeOwnedIosInstaller({ ...options(), launch: fixture("process.exitCode=0"),
    signalGroup: () => { throw failure; } }), error => error === failure);
});

test("denied cancellation of live held-pipe descendants fails within the original deadline without claiming a join", { skip: !posix, timeout: 5000 }, async t => {
  const controller = new AbortController(), records = [], request = options();
  let child, descendant, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const grandchild = "process.stdout.write(JSON.stringify({ready:process.pid})+'\\n');setInterval(()=>{},1000)";
  const launch = fixture(`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'});setInterval(()=>{},1000)`);
  t.after(async () => {
    if (!child) return;
    // Test-owned teardown is separate from the denied production signal.
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once("close", resolve));
    if (descendant) assertStopped(descendant);
  });
  let buffered = "";
  const denied = Object.assign(new Error("controlled signal denial"), { code: "EPERM" });
  const pending = executeOwnedIosInstaller({ ...request, signal: controller.signal, report: value => records.push(value),
    signalGroup: () => { throw denied; },
    launch: (...args) => {
      child = launch(...args);
      child.stdout.on("data", chunk => {
        buffered += chunk;
        if (buffered.includes("\n")) resolveReady(JSON.parse(buffered.split("\n")[0]).ready);
      });
      return child;
    } });
  descendant = await ready;
  const reason = new Error("original request deadline");
  const rejected = assert.rejects(pending, error => error instanceof AggregateError &&
    error.errors[0] === reason && error.errors[1] === denied && error.cleanupUncertain === true &&
    error.joined === false && error.processGroupId === child.pid);
  controller.abort(reason);
  await rejected;
  assert(Date.now() < request.deadlineMs);
  assert.equal(records.filter(record => record.phase === "group-kill-starting").length, 1);
  assert(records.some(record => record.phase === "installer-cleanup-uncertain" && record.joined === false));
  assert(!records.some(record => record.phase === "installer-joined"));
  // The error is truthful: the test owner, not the failed operation, still
  // has to stop these live processes in its explicit teardown above.
  process.kill(child.pid, 0);
  process.kill(descendant, 0);
});

test("failed milestone retention still kills and joins the already-started helper", { skip: !posix, timeout: 5000 }, async () => {
  const failure = new Error("controlled trace failure");
  await assert.rejects(executeOwnedIosInstaller({ ...options(), launch: fixture("setInterval(()=>{},1000)"),
    report: () => { throw failure; } }), error => error === failure);
});
