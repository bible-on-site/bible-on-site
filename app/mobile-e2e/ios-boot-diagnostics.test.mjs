import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { iosBootDiagnosticOutput, startIosResourceSampler, withIosResourceSampler } from "./ios-boot-diagnostics.mjs";

const identity = { udid: "4AD2086B-7B8F-4608-A742-AA422A0B8D74", nonce: "a".repeat(32), deadlineMs: 301000 };

test("boot output and host resources have separate hard caps and continue discarding", () => {
  const records = [];
  const output = iosBootDiagnosticOutput({ ...identity, now: () => 1000, write: line => records.push(JSON.parse(line)) });
  output.bootstatus("stdout", Buffer.alloc(65530, 65));
  output.bootstatus("stderr", Buffer.alloc(100, 66));
  for (let index = 0; index < 100; index++) output.bootstatus("stdout", Buffer.alloc(1000, 67));
  output["host-resources"]("stdout", Buffer.alloc(200000, 68));
  output["host-resources"]("stderr", Buffer.alloc(200000, 69));
  assert.equal(records.length, 3);
  assert.deepEqual(records.map(record => record.retainedBytes), [65530, 65536, 131072]);
  assert.equal(records[1].text, "B".repeat(6));
  assert.equal(records[1].truncated, true);
  assert.equal(records[2].truncated, true);
  assert(records.every(record => record.udid === identity.udid && record.nonce === identity.nonce && record.remainingMs === 300000));
});

test("tiny native writes cannot amplify diagnostic framing without a bound", () => {
  const records = [];
  const output = iosBootDiagnosticOutput({ ...identity, write: line => records.push(JSON.parse(line)) });
  for (let index = 0; index < 10000; index++) output.bootstatus("stdout", Buffer.from("x"));
  assert.equal(records.length, 513);
  assert.equal(records.at(-1).retainedBytes, 512);
  assert.equal(records.at(-1).truncated, true);
  assert.equal(records.at(-1).text, "");
});

test("the fixed read-only sampler drains beyond its cap and joins its actual child", { timeout: 5000 }, async () => {
  const records = [], writes = [];
  const output = iosBootDiagnosticOutput({ ...identity, write: line => records.push(JSON.parse(line)) });
  let child;
  const sampler = startIosResourceSampler(output["host-resources"], { deadlineMs: Date.now() + 4000, launch: (command, args, configuration) => {
    assert.equal(command, "/usr/bin/top");
    assert.deepEqual(args, ["-l", "31", "-s", "10", "-n", "12", "-o", "cpu", "-F", "-R", "-S",
      "-stats", "pid,command,cpu,mem,threads,state,ppid,pgrp"]);
    assert.equal(configuration.detached, undefined);
    child = spawn(process.execPath, ["-e", "process.stdout.write('x'.repeat(1048576),()=>process.stderr.write('drained'));setInterval(()=>{},1000)"], configuration);
    child.stderr.on("data", chunk => writes.push(String(chunk)));
    return child;
  } });
  while (!writes.join("").includes("drained")) await once(child.stderr, "data");
  await sampler.stop();
  await sampler.stop();
  assert.equal(child.signalCode, "SIGKILL");
  assert.equal(records.at(-1).retainedBytes, 131072);
  assert.equal(records.filter(record => record.truncated).length, 1);
});

test("sampler output retention errors still drain and fail after its owned child joins", { timeout: 5000 }, async () => {
  const retention = new Error("controlled diagnostic write failure");
  let child;
  const sampler = startIosResourceSampler(() => { throw retention; }, { deadlineMs: Date.now() + 4000, launch: (_command, _args, configuration) => {
    child = spawn(process.execPath, ["-e", "process.stdout.write('observed');setInterval(()=>{},1000)"], configuration);
    return child;
  } });
  await once(child.stdout, "data");
  await assert.rejects(sampler.stop(), error => error === retention);
  assert.equal(child.signalCode, "SIGKILL");
});

test("an expired sampler cannot launch and an already failed child cannot become a successful stop", { timeout: 5000 }, async () => {
  assert.throws(() => startIosResourceSampler(() => {}, { deadlineMs: Date.now() - 1,
    launch: () => assert.fail("must not launch") }), /original preparation deadline/);
  let child;
  const sampler = startIosResourceSampler(() => {}, { deadlineMs: Date.now() + 4000, launch: (_command, _args, configuration) => {
    child = spawn(process.execPath, ["-e", "process.exitCode=7"], configuration);
    return child;
  } });
  await once(child, "exit");
  await assert.rejects(sampler.stop(), /code 7/);
});

test("resource cleanup preserves the preparation cause and joins before returning a receipt", async () => {
  const order = [], primary = new Error("boot failed"), secondary = new Error("join failed");
  await assert.rejects(withIosResourceSampler(async () => { throw primary; }, () => ({ stop: async () => { throw secondary; } })),
    error => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === secondary);
  assert.equal(await withIosResourceSampler(async () => { order.push("receipt"); return "exact receipt"; },
    () => ({ stop: async () => { order.push("joined"); } })), "exact receipt");
  assert.deepEqual(order, ["receipt", "joined"]);
});
