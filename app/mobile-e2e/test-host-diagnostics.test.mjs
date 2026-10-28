import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { captureTestHostStacks, monitorTestHostShutdown } from "./test-host-diagnostics.mjs";
import { watchScenarioFailures } from "./scenario-failure-monitor.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "mobile-host-stacks-"));
  t.after(async () => {
    assert.ok(!relative(resolve(tmpdir()), directory).startsWith(".."));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("captures a fragmented shutdown warning once without joining stdout and stderr", async () => {
  let captures = 0;
  const monitor = monitorTestHostShutdown(() => { captures++; });
  monitor.write("Test run summary: Passed!\nWaiting 10 seconds for fore", "stdout");
  monitor.write("ground threads to exit...", "stderr");
  assert.equal(captures, 0);
  monitor.write("ground threads to exit...\n", "stdout");
  monitor.write("Waiting 10 seconds for foreground threads to exit...\n", "stderr");
  await monitor.stop();
  assert.equal(captures, 1);
});

test("normal shutdown does not capture; stop prevents later work", async () => {
  const monitor = monitorTestHostShutdown(() => assert.fail("unexpected stack capture"));
  monitor.write("Test run summary: Passed!\n");
  await monitor.stop();
  monitor.write("Waiting 10 seconds for foreground threads to exit...\n");
});

test("stop reports a failed capture", async () => {
  const monitor = monitorTestHostShutdown(() => { throw new Error("capture failed"); });
  monitor.write("Waiting 10 seconds for foreground threads to exit...\n");
  await assert.rejects(monitor.stop(), /capture failed/);
});

test("captures only registered hosts concurrently within one shared deadline", async t => {
  const directory = await fixture(t);
  for (const pid of [101, 102]) await writeFile(join(directory, `host-${pid}.json`), JSON.stringify({ pid }));
  await writeFile(join(directory, "unrelated.json"), JSON.stringify({ pid: 999 }));
  const calls = [];
  await captureTestHostStacks(directory, "stack-tool", async (tool, args, options) => {
    calls.push({ tool, args, options });
    return { stdout: `thread stack ${args.at(-1)}`, stderr: "" };
  });
  assert.deepEqual(calls.map(call => call.args.at(-1)).sort(), ["101", "102"]);
  assert.equal(calls[0].options.signal, calls[1].options.signal);
  assert.equal(calls[0].options.timeout, 5000);
  for (const call of calls) {
    assert.equal(call.tool, "stack-tool");
    assert.deepEqual(call.args.slice(0, 2), ["report", "--process-id"]);
    assert.equal(await readFile(join(directory, `stack-${call.args.at(-1)}.txt`), "utf8"), `thread stack ${call.args.at(-1)}`);
  }
});

test("an exited host preserves diagnostic errors without changing the test exit code", async t => {
  const directory = await fixture(t);
  await writeFile(join(directory, "host-101.json"), JSON.stringify({ pid: 101 }));
  await captureTestHostStacks(directory, "stack-tool", async () => {
    throw Object.assign(new Error("process exited"), { stdout: "partial stack", stderr: "connection closed" });
  });
  assert.equal(await readFile(join(directory, "stack-101-error.txt"), "utf8"), "process exited\npartial stack\nconnection closed");
});

test("rejects missing or mismatched process registrations before attaching", async t => {
  const directory = await fixture(t);
  const execute = () => assert.fail("must not inspect an unregistered process");
  await assert.rejects(captureTestHostStacks(directory, "stack-tool", execute), /No registered/);
  await writeFile(join(directory, "host-101.json"), JSON.stringify({ pid: 999 }));
  await assert.rejects(captureTestHostStacks(directory, "stack-tool", execute), /Invalid harness process/);
});

const failureId = "0123456789abcdef0123456789abcdef";
const otherFailureId = "abcdef0123456789abcdef0123456789";
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function failureRequest(id = failureId, values = {}) {
  const failed = Date.now();
  return { id, test: "preferences scenario", sessionId: "existing-session",
    failedAtUtc: new Date(failed).toISOString(), deadlineUtc: new Date(failed + 15000).toISOString(), ...values };
}
function watcherFixture() {
  let listener;
  return { closed: false, watch(_directory, callback) { listener = callback; return this; },
    on() { return this; }, close() { this.closed = true; }, emit(name) { listener("rename", name); } };
}
function closeOnTestExit(t, monitor) {
  // Each test explicitly checks stop's result. This final safety cleanup also
  // closes the watcher if an earlier assertion or the test deadline fails.
  t.after(async () => { try { await monitor.stop(); } catch { /* already asserted by the test */ } });
  return monitor;
}
function scenarioMonitor(t, directory, capture, options) {
  return closeOnTestExit(t, watchScenarioFailures(directory, capture, options));
}
async function publishFailure(directory, request) {
  const temporary = join(directory, `${request.id}.pending`);
  await writeFile(temporary, JSON.stringify(request));
  await rename(temporary, join(directory, `${request.id}.request.json`));
}

test("scenario watcher observes real atomic publication and writes unique matching acknowledgements", { timeout: 5000 }, async t => {
  const directory = await fixture(t);
  const finished = deferred();
  const calls = [];
  const monitor = scenarioMonitor(t, directory, async request => { calls.push(request.id); return { status: "captured" }; },
    { observe: () => { if (calls.length === 2) finished.resolve(); } });
  await publishFailure(directory, failureRequest());
  await publishFailure(directory, failureRequest(otherFailureId));
  await finished.promise;
  await monitor.stop();
  assert.equal(monitor.received, 2);
  assert.deepEqual(calls.sort(), [failureId, otherFailureId].sort());
  for (const id of calls) assert.deepEqual(JSON.parse(await readFile(join(directory, `${id}.ack.json`), "utf8")), { id, status: "captured" });
});

test("stop drains an already queued startup scan instead of discarding its failure handoff", { timeout: 5000 }, async t => {
  const directory = await fixture(t); let captures = 0;
  await publishFailure(directory, failureRequest());
  const monitor = scenarioMonitor(t, directory, async () => { captures++; return { status: "captured" }; });
  await monitor.stop();
  assert.equal(monitor.received, 1);
  assert.equal(captures, 1);
  assert.equal(JSON.parse(await readFile(join(directory, `${failureId}.ack.json`), "utf8")).status, "captured");
});

test("stop counts a receipt missed by a silent watcher without starting late native sampling", { timeout: 5000 }, async t => {
  const directory = await fixture(t); const watcher = watcherFixture(); const firstObserved = deferred();
  await publishFailure(directory, failureRequest(failureId, { sessionId: null }));
  const monitor = scenarioMonitor(t, directory, () => assert.fail("must not start late native sampling"),
    { watch: watcher.watch.bind(watcher), observe: firstObserved.resolve });
  await firstObserved.promise;
  await publishFailure(directory, failureRequest(otherFailureId));
  await monitor.stop();
  assert.equal(watcher.closed, true);
  assert.equal(monitor.received, 2);
  await assert.rejects(readFile(join(directory, `${otherFailureId}.ack.json`)), { code: "ENOENT" });
});

test("duplicate watch events capture once, and acknowledgement waits for the capture", { timeout: 5000 }, async t => {
  const directory = await fixture(t);
  const watcher = watcherFixture();
  const started = deferred(); const release = deferred(); const acknowledged = deferred();
  let calls = 0;
  const monitor = scenarioMonitor(t, directory, async () => { calls++; started.resolve(); await release.promise; return { status: "exited" }; },
    { watch: watcher.watch.bind(watcher), observe: acknowledged.resolve });
  await publishFailure(directory, failureRequest());
  watcher.emit(`${failureId}.request.json`);
  watcher.emit(Buffer.from(`${failureId}.request.json`));
  await started.promise;
  assert.equal(calls, 1);
  assert.equal(monitor.received, 1);
  await assert.rejects(readFile(join(directory, `${failureId}.ack.json`)), { code: "ENOENT" });
  release.resolve(); await acknowledged.promise; await monitor.stop();
  assert.equal(watcher.closed, true);
  assert.equal(JSON.parse(await readFile(join(directory, `${failureId}.ack.json`), "utf8")).status, "exited");
  watcher.emit(`${otherFailureId}.request.json`);
  assert.equal(monitor.received, 1);
});

test("capture rejection is acknowledged and reported by stop without an unhandled promise", { timeout: 5000 }, async t => {
  const directory = await fixture(t); const acknowledged = deferred();
  const monitor = scenarioMonitor(t, directory, async () => { throw new Error("native capture failed"); }, { observe: acknowledged.resolve });
  await publishFailure(directory, failureRequest()); await acknowledged.promise;
  const ack = JSON.parse(await readFile(join(directory, `${failureId}.ack.json`), "utf8"));
  assert.equal(ack.status, "error"); assert.equal(ack.id, failureId); assert.match(ack.error, /native capture failed/);
  await assert.rejects(monitor.stop(), error => error instanceof AggregateError && error.errors.some(item => /native capture failed/.test(item.message)));
});

test("returned capture errors preserve structured diagnostics in the acknowledgement and stop result", { timeout: 5000 }, async t => {
  const directory = await fixture(t); const acknowledged = deferred();
  const error = { message: "native process terminated", code: 9, signal: "SIGKILL" };
  const monitor = scenarioMonitor(t, directory, async () => ({ status: "error", error }), { observe: acknowledged.resolve });
  await publishFailure(directory, failureRequest()); await acknowledged.promise;
  assert.deepEqual(JSON.parse(await readFile(join(directory, `${failureId}.ack.json`), "utf8")), { id: failureId, status: "error", error });
  await assert.rejects(monitor.stop(), failure => failure instanceof AggregateError && failure.errors.some(item => item.message === error.message));
});

for (const [label, values, status] of [
  ["expired", { failedAtUtc: "1970-01-01T00:00:00.000Z", deadlineUtc: "1970-01-01T00:00:15.000Z" }, "expired"],
  ["missing session", { sessionId: null }, "unknown"],
]) test(`scenario watcher counts and acknowledges ${label} without sampling`, { timeout: 5000 }, async t => {
  const directory = await fixture(t); const acknowledged = deferred();
  const monitor = scenarioMonitor(t, directory, () => assert.fail("must not sample"), { observe: acknowledged.resolve });
  await publishFailure(directory, failureRequest(failureId, values)); await acknowledged.promise; await monitor.stop();
  assert.equal(monitor.received, 1);
  assert.equal(JSON.parse(await readFile(join(directory, `${failureId}.ack.json`), "utf8")).status, status);
});

test("scenario watcher rejects invalid identity, test and deadline payloads without sampling", async t => {
  for (const values of [{ id: otherFailureId }, { test: "" }, { test: "bad\nname" }, { sessionId: "../session" },
    { failedAtUtc: "not-a-date" }, { deadlineUtc: new Date(Date.now() + 30000).toISOString() }]) {
    const directory = await fixture(t); const watcher = watcherFixture();
    const monitor = scenarioMonitor(t, directory, () => assert.fail("must not sample"), { watch: watcher.watch.bind(watcher) });
    await writeFile(join(directory, `${failureId}.request.json`), JSON.stringify(failureRequest(failureId, values)));
    watcher.emit(`${failureId}.request.json`);
    await assert.rejects(monitor.stop(), AggregateError);
    assert.equal(monitor.received, 1);
    await assert.rejects(readFile(join(directory, `${failureId}.ack.json`)), { code: "ENOENT" });
  }
});

test("scenario watcher rejects an unsafe event path and clean stop prevents later work", async t => {
  const directory = await fixture(t); const watcher = watcherFixture();
  const monitor = scenarioMonitor(t, directory, () => assert.fail("must not sample"), { watch: watcher.watch.bind(watcher) });
  watcher.emit(`../${failureId}.request.json`);
  await assert.rejects(monitor.stop(), AggregateError);
  assert.equal(watcher.closed, true);
  assert.equal(monitor.received, 1);
  const clean = scenarioMonitor(t, directory, () => assert.fail("stopped watcher must not capture"));
  await clean.stop(); await clean.stop();
});

test("canonical UTC offsets are accepted and a deadline aborts capture without acknowledging unfinished sampling", { timeout: 5000 }, async t => {
  const directory = await fixture(t); const started = deferred(); const release = deferred();
  const fixed = Date.parse("2026-10-28T17:00:00Z");
  let aborted = false;
  const monitor = scenarioMonitor(t, directory, (_request, { signal }) => {
    started.resolve(); signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    return release.promise;
  }, { now: () => fixed });
  await publishFailure(directory, failureRequest(failureId, {
    failedAtUtc: "2026-10-28T16:59:45.1000000+00:00", deadlineUtc: "2026-10-28T17:00:00.1000000+00:00",
  }));
  await started.promise;
  await assert.rejects(monitor.stop(), AggregateError);
  assert.equal(aborted, true);
  await assert.rejects(readFile(join(directory, `${failureId}.ack.json`)), { code: "ENOENT" });
  release.resolve({ status: "captured" });
  await Promise.resolve();
  await assert.rejects(readFile(join(directory, `${failureId}.ack.json`)), { code: "ENOENT" });
});
