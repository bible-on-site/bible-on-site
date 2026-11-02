import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { createConnection } from "node:net";
import { captureTestHostStacks, monitorTestHostShutdown } from "./test-host-diagnostics.mjs";
import { listenScenarioFailures, watchScenarioFailures } from "./scenario-failure-monitor.mjs";

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
  return closeOnTestExit(t, watchScenarioFailures(directory, capture, { watch: null, ...options }));
}
async function publishFailure(directory, request) {
  const temporary = join(directory, `${request.id}.pending`);
  await writeFile(temporary, JSON.stringify(request));
  await rename(temporary, join(directory, `${request.id}.request.json`));
}

function notifyFailure(port, input, { end = false } = {}) {
  return new Promise(resolveReply => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const chunks = [];
    let error;
    socket.on("error", failure => { error = failure; });
    socket.on("data", chunk => { chunks.push(chunk); });
    socket.on("close", () => resolveReply({ reply: Buffer.concat(chunks).toString("utf8"), error }));
    socket.on("connect", () => {
      for (const chunk of Array.isArray(input) ? input : [input]) socket.write(chunk);
      if (end) socket.end();
    });
  });
}

test("ready loopback channel captures atomic publications after the startup scan while filesystem events are lost", { timeout: 5000 }, async t => {
  const directory = await fixture(t); const initialObserved = deferred(); const calls = [];
  await publishFailure(directory, failureRequest(failureId, { sessionId: null }));
  const watcher = watcherFixture();
  const monitor = closeOnTestExit(t, await listenScenarioFailures(directory, async request => {
    calls.push(request.id); return { status: "captured" };
  }, { watch: watcher.watch.bind(watcher), observe: ack => { if (ack.id === failureId) initialObserved.resolve(); } }));
  await initialObserved.promise;
  assert.deepEqual(calls, []);
  const thirdId = "22222222222222222222222222222222";
  for (const id of [otherFailureId, thirdId]) await publishFailure(directory, failureRequest(id));
  // The injected native watcher never becomes ready and emits no events.
  // Both receipts were published after the initial scan completed.
  const replies = await Promise.all([otherFailureId, thirdId].map(id => notifyFailure(monitor.port, id + "\n")));
  assert.deepEqual(replies.map(item => item.reply), [otherFailureId + "\n", thirdId + "\n"]);
  assert.equal(monitor.received, 3);
  assert.deepEqual(calls.sort(), [otherFailureId, thirdId].sort());
  for (const id of calls) assert.deepEqual(JSON.parse(await readFile(join(directory, id + ".ack.json"), "utf8")), { id, status: "captured" });
  await monitor.stop();
});

test("loopback notification joins watcher work and withholds its reply until capture and ack publication", { timeout: 5000 }, async t => {
  const directory = await fixture(t); const watcher = watcherFixture();
  const started = deferred(); const release = deferred(); let calls = 0;
  const monitor = closeOnTestExit(t, await listenScenarioFailures(directory, async () => {
    calls++; started.resolve(); await release.promise; return { status: "captured" };
  }, { watch: watcher.watch.bind(watcher) }));
  await publishFailure(directory, failureRequest());
  watcher.emit(failureId + ".request.json");
  await started.promise;
  const response = notifyFailure(monitor.port, [failureId.slice(0, 16), failureId.slice(16) + "\n"]);
  await assert.rejects(readFile(join(directory, failureId + ".ack.json")), { code: "ENOENT" });
  release.resolve();
  assert.equal((await response).reply, failureId + "\n");
  assert.equal(calls, 1);
  assert.equal(JSON.parse(await readFile(join(directory, failureId + ".ack.json"), "utf8")).id, failureId);
  await monitor.stop();
});

test("loopback framing rejects malformed, oversized and incomplete input before capture", { timeout: 5000 }, async t => {
  for (const input of [failureId.toUpperCase() + "\n", failureId + "\r\n", failureId + "\nx",
    failureId.slice(1) + "\n", Buffer.concat([Buffer.from([0xff]), Buffer.from(failureId.slice(1) + "\n")])]) {
    const directory = await fixture(t);
    const monitor = closeOnTestExit(t, await listenScenarioFailures(directory, () => assert.fail("must not capture malformed input")));
    assert.equal((await notifyFailure(monitor.port, input, { end: true })).reply, "");
    assert.equal(monitor.received, 0);
    await assert.rejects(monitor.stop(), AggregateError);
  }
});

test("loopback notification cannot acknowledge a missing or mismatched durable request", { timeout: 5000 }, async t => {
  for (const mismatchedAck of [false, true]) {
    const directory = await fixture(t);
    if (mismatchedAck) {
      await publishFailure(directory, failureRequest());
      await writeFile(join(directory, failureId + ".ack.json"), JSON.stringify({ id: otherFailureId, status: "captured" }));
    }
    const monitor = closeOnTestExit(t, await listenScenarioFailures(directory, () => assert.fail("must not capture invalid request")));
    assert.equal((await notifyFailure(monitor.port, failureId + "\n")).reply, "");
    await assert.rejects(monitor.stop(), AggregateError);
  }
});

test("loopback deadline never replies or publishes an ack while cancelled capture remains unsettled", { timeout: 5000 }, async t => {
  const directory = await fixture(t); const started = deferred(); const release = deferred();
  const now = Date.parse("2026-10-28T17:00:00.000Z"); let aborted = false;
  const monitor = closeOnTestExit(t, await listenScenarioFailures(directory, (_request, { signal }) => {
    signal.addEventListener("abort", () => { aborted = true; }); started.resolve(); return release.promise;
  }, { now: () => now }));
  await publishFailure(directory, failureRequest(failureId, {
    failedAtUtc: "2026-10-28T16:59:45.100Z", deadlineUtc: "2026-10-28T17:00:00.100Z",
  }));
  const response = notifyFailure(monitor.port, failureId + "\n");
  await started.promise;
  assert.equal((await response).reply, "");
  assert.equal(aborted, true);
  await assert.rejects(readFile(join(directory, failureId + ".ack.json")), { code: "ENOENT" });
  await assert.rejects(monitor.stop(), AggregateError);
  release.resolve({ status: "captured" });
  await Promise.resolve();
  await assert.rejects(readFile(join(directory, failureId + ".ack.json")), { code: "ENOENT" });
});

test("loopback clean shutdown closes an incomplete connection without launching work", { timeout: 5000 }, async t => {
  const directory = await fixture(t);
  const monitor = closeOnTestExit(t, await listenScenarioFailures(directory, () => assert.fail("must not capture on stop")));
  const socket = createConnection({ host: "127.0.0.1", port: monitor.port });
  socket.on("error", () => { /* shutdown may reset an incomplete local connection */ });
  await new Promise(resolveConnected => socket.once("connect", resolveConnected));
  socket.write("abc");
  const closed = new Promise(resolveClosed => socket.once("close", resolveClosed));
  await monitor.stop(); await closed;
  assert.equal(monitor.received, 0);
  await monitor.stop();
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
  await publishFailure(directory, failureRequest()); await monitor.notify(failureId); await acknowledged.promise;
  const ack = JSON.parse(await readFile(join(directory, `${failureId}.ack.json`), "utf8"));
  assert.equal(ack.status, "error"); assert.equal(ack.id, failureId); assert.match(ack.error, /native capture failed/);
  await assert.rejects(monitor.stop(), error => error instanceof AggregateError && error.errors.some(item => /native capture failed/.test(item.message)));
});

test("returned capture errors preserve structured diagnostics in the acknowledgement and stop result", { timeout: 5000 }, async t => {
  const directory = await fixture(t); const acknowledged = deferred();
  const error = { message: "native process terminated", code: 9, signal: "SIGKILL" };
  const monitor = scenarioMonitor(t, directory, async () => ({ status: "error", error }), { observe: acknowledged.resolve });
  await publishFailure(directory, failureRequest()); await monitor.notify(failureId); await acknowledged.promise;
  assert.deepEqual(JSON.parse(await readFile(join(directory, `${failureId}.ack.json`), "utf8")), { id: failureId, status: "error", error });
  await assert.rejects(monitor.stop(), failure => failure instanceof AggregateError && failure.errors.some(item => item.message === error.message));
});

for (const [label, values, status] of [
  ["expired", { failedAtUtc: "1970-01-01T00:00:00.000Z", deadlineUtc: "1970-01-01T00:00:15.000Z" }, "expired"],
  ["missing session", { sessionId: null }, "unknown"],
]) test(`scenario watcher counts and acknowledges ${label} without sampling`, { timeout: 5000 }, async t => {
  const directory = await fixture(t); const acknowledged = deferred();
  const monitor = scenarioMonitor(t, directory, () => assert.fail("must not sample"), { observe: acknowledged.resolve });
  await publishFailure(directory, failureRequest(failureId, values)); await monitor.notify(failureId); await acknowledged.promise; await monitor.stop();
  assert.equal(monitor.received, 1);
  assert.equal(JSON.parse(await readFile(join(directory, `${failureId}.ack.json`), "utf8")).status, status);
});

test("scenario watcher rejects invalid identity, test and deadline payloads without sampling", async t => {
  for (const values of [{ id: otherFailureId }, { test: "" }, { test: "bad\nname" }, { test: "bad\u0000name" },
    { test: "bad\u007fname" }, { test: "a".repeat(2049) }, { sessionId: "../session" }, { sessionId: "" },
    { sessionId: "a".repeat(129) }, { sessionId: "a".repeat(4096) }, { sessionId: "session_id" }, { sessionId: "séssion" },
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

test("session and Unicode test names retain their accepted length boundaries", { timeout: 5000 }, async t => {
  for (const sessionId of ["A", "Az0-".repeat(32)]) {
    const directory = await fixture(t); const acknowledged = deferred(); const calls = [];
    const monitor = scenarioMonitor(t, directory, async request => { calls.push(request); return { status: "captured" }; },
      { observe: acknowledged.resolve });
    await publishFailure(directory, failureRequest(failureId, { sessionId, test: "א".repeat(2048) }));
    await monitor.notify(failureId); await acknowledged.promise; await monitor.stop();
    assert.equal(calls.length, 1); assert.equal(calls[0].sessionId, sessionId); assert.equal(calls[0].test.length, 2048);
  }
});

test("filename validation rejects wrong lengths and non-ASCII hex without sampling", async t => {
  for (const id of [failureId.slice(1), `${failureId}f`, failureId.toUpperCase(), `é${failureId.slice(1)}`, "a".repeat(4096)]) {
    const directory = await fixture(t); const watcher = watcherFixture();
    const monitor = scenarioMonitor(t, directory, () => assert.fail("must not sample malformed identity"),
      { watch: watcher.watch.bind(watcher) });
    watcher.emit(`${id}.request.json`);
    await assert.rejects(monitor.stop(), AggregateError);
    assert.equal(monitor.received, 1);
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
  void monitor.notify(failureId);
  await started.promise;
  await assert.rejects(monitor.stop(), AggregateError);
  assert.equal(aborted, true);
  await assert.rejects(readFile(join(directory, `${failureId}.ack.json`)), { code: "ENOENT" });
  release.resolve({ status: "captured" });
  await Promise.resolve();
  await assert.rejects(readFile(join(directory, `${failureId}.ack.json`)), { code: "ENOENT" });
});
