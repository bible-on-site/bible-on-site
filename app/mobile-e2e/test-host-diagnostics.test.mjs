import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { captureTestHostStacks, monitorTestHostShutdown } from "./test-host-diagnostics.mjs";

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
