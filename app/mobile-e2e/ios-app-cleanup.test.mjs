import assert from "node:assert/strict";
import { test } from "node:test";
import { terminateIosTestApp } from "./ios-app-cleanup.mjs";

test("terminates only the test app on its explicit simulator without XCTest or retries", async () => {
  const calls = [];
  const result = await terminateIosTestApp("owned-simulator", { execute: async (...args) => { calls.push(args); } });
  assert.deepEqual(calls, [["xcrun", ["simctl", "terminate", "owned-simulator", "com.tanah.daily929"], { timeout: 5000, windowsHide: true }]]);
  assert.equal(result.status, "terminated");
  assert.equal(result.udid, "owned-simulator");
  assert.ok(result.elapsedMs >= 0);
});

test("keep-app review leaves the app running and missing ownership fails before execution", async () => {
  const execute = async () => { throw new Error("must not execute"); };
  assert.equal((await terminateIosTestApp("owned-simulator", { keepApp: true, execute })).status, "kept");
  await assert.rejects(terminateIosTestApp("", { execute }), /explicit UDID/);
});

test("a confirmed already-stopped app is successful cleanup", async () => {
  const result = await terminateIosTestApp("owned-simulator", { execute: async () => {
    throw Object.assign(new Error("Application termination failed"), { stderr:
      "An error was encountered (domain=NSPOSIXErrorDomain, code=3): found nothing to terminate" });
  } });
  assert.equal(result.status, "already-stopped");
});

test("transport errors and the unchanged command deadline remain failures without retry", async () => {
  for (const error of [new Error("Simulator device unavailable"),
    Object.assign(new Error("xcrun timed out"), { killed: true }),
    Object.assign(new Error("unknown error"), { stderr: "domain=NSPOSIXErrorDomain, code=3" })]) {
    let calls = 0;
    await assert.rejects(terminateIosTestApp("owned-simulator", { execute: async () => { calls++; throw error; } }), e => e === error);
    assert.equal(calls, 1);
  }
});
