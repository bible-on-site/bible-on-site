import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { supervise } from "./supervise.mjs";

for (const code of [0, 7]) {
  test(`preserves a completed harness exit ${code}`, async () => {
    const run = supervise(process.execPath, ["-e", "process.exit(Number(process.argv[1]))", String(code)],
      { timeoutMs: 5000, stdio: "ignore" });
    assert.equal(await run.result, code);
  });
}

// Both processes ignore TERM on POSIX. The parent exits on the first TERM so
// this also catches the mistake of canceling escalation when only it has died.
const stubbornTree = `
const {spawn} = require('node:child_process');
const {writeFileSync} = require('node:fs');
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"], {stdio:['ignore','ignore','ignore','ipc']});
process.on('SIGTERM', () => process.exit(0));
child.once('message', () => {
  writeFileSync(process.argv[1], JSON.stringify([process.pid, child.pid]));
  if (process.argv[2] === "block") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
});
setInterval(() => {}, 1000);
`;
async function waitForTree(path) {
  const deadline = Date.now() + 5000;
  while (!existsSync(path) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(existsSync(path), "The process tree must start before exercising shutdown");
  return JSON.parse(readFileSync(path, "utf8"));
}
async function assertStopped(pid) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") return; throw error; }
    if (process.platform !== "win32") {
      try {
        const state = execFileSync("ps", ["-o", "stat=", "-p", String(pid)],
          { encoding: "utf8", timeout: 1000, killSignal: "SIGKILL" }).trim();
        // A zombie has exited and cannot execute code, although its PID still
        // answers kill(0) while the OS/parent waits to reap its exit status.
        if (/^[ZX]/.test(state)) return;
      } catch (error) {
        if (error.status === 1) return;
        throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`Owned process ${pid} survived shutdown`);
}
for (const reason of ["deadline", "cancellation", "blocked-wrapper"]) {
  test(`${reason} stops grandchildren even after the wrapper exits`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "mobile-supervisor-"));
    const ready = join(directory, "pids.json");
    let run;
    let triggerDeadline;
    let pids = [];
    try {
      run = supervise(process.execPath, ["-e", stubbornTree, ready, reason === "blocked-wrapper" ? "block" : "idle"], {
        graceMs: 100, stdio: "ignore",
        scheduleDeadline(callback) { triggerDeadline = callback; },
      });
      pids = await waitForTree(ready);
      if (reason === "cancellation") run.stop();
      else triggerDeadline();
      assert.equal(await run.result, reason === "cancellation" ? 143 : 124);
      for (const pid of pids) await assertStopped(pid);
    } finally {
      run?.stop();
      if (run) await run.result;
      // A failed tree-shutdown assertion must not leave owned children keeping
      // the test worker alive. This cleanup runs after the assertion, so a
      // shutdown failure remains a failure.
      for (const pid of pids) {
        try { process.kill(pid, "SIGKILL"); }
        catch (error) { if (error.code !== "ESRCH") throw error; }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

// The wrapper can die before any shutdown runs; its orphaned children carry
// the dead ParentProcessId, which the Windows CIM walk still matches.
test("an exited wrapper still has its orphaned children reaped", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mobile-supervisor-"));
  const ready = join(directory, "pids.json");
  let run;
  let pids = [];
  try {
    run = supervise(process.execPath, ["-e", stubbornTree, ready, "idle"], {
      graceMs: 100, stdio: "ignore",
      scheduleDeadline() {},
    });
    pids = await waitForTree(ready);
    process.kill(pids[0], "SIGKILL");
    assert.equal(await run.result, 1);
    for (const pid of pids) await assertStopped(pid);
  } finally {
    run?.stop();
    if (run) await run.result;
    for (const pid of pids) {
      try { process.kill(pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

// #2423: the harness must know the supervisor's deadline so post-test cleanup
// can bound itself instead of consuming the remaining budget silently.
test("injects the pilot deadline into the harness environment", async () => {
	const run = supervise(
		process.execPath,
		["-e", "process.stdout.write(process.env.MOBILE_E2E_PILOT_DEADLINE_MS ?? 'unset')"],
		{ timeoutMs: 60_000, stdio: ["ignore", "pipe", "ignore"] },
	);
	let output = "";
	run.child.stdout.on("data", (chunk) => (output += chunk));
	assert.equal(await run.result, 0);
	const deadline = Number(output);
	const now = Date.now();
	assert.ok(
		Number.isFinite(deadline) && deadline > now - 60_000 && deadline <= now + 60_000,
		`deadline ${output} should be roughly now+timeout`,
	);
});

test("the production clock expires without waiting for child progress", async () => {
  let expired = false;
  const run = supervise(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)"], {
    timeoutMs: 100, graceMs: 100, stdio: "ignore", onDeadline() { expired = true; },
  });
  try {
    assert.equal(await run.result, 124);
    assert.equal(expired, true);
    await assertStopped(run.child.pid);
  } finally {
    // A failed shutdown must fail the assertion and also release the worker.
    try { process.kill(run.child.pid, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
});
