import assert from "node:assert/strict";
import { test } from "node:test";
import { runUntilComplete } from "./prepare-wda.mjs";

// The download loop must keep retrying a stalled fetch but never hide the
// final failure — and `reset` must run before every attempt so a timed-out
// half-extraction cannot fake completeness.

test("returns immediately when the artifact is already complete", () => {
  let spawns = 0;
  runUntilComplete(() => spawns++, () => true, () => {
    throw new Error("reset must not run when nothing is needed");
  });
  assert.equal(spawns, 0);
});

test("succeeds on the first live attempt without resetting a healthy state", () => {
  const calls = { spawns: 0, resets: 0, done: false };
  runUntilComplete(
    () => {
      calls.spawns++;
      calls.done = true;
    },
    () => calls.done,
    () => calls.resets++);
  assert.deepEqual(calls, { spawns: 1, resets: 1, done: true });
});

test("retries a failing download and clears partial output between attempts", () => {
  const calls = { spawns: 0, resets: 0, done: false };
  runUntilComplete(
    () => {
      calls.spawns++;
      if (calls.spawns < 3) throw new Error("ETIMEDOUT");
      calls.done = true;
    },
    () => calls.done,
    () => calls.resets++);
  assert.deepEqual(calls, { spawns: 3, resets: 3, done: true });
});

test("throws the last download error after exhausting every attempt", () => {
  const calls = { spawns: 0, resets: 0 };
  assert.throws(
    () => runUntilComplete(
      () => {
        calls.spawns++;
        throw new Error(`attempt ${calls.spawns} stalled`);
      },
      () => false,
      () => calls.resets++),
    /attempt 3 stalled/);
  assert.deepEqual(calls, { spawns: 3, resets: 3 });
});

test("keeps retrying when the download exits cleanly but the marker never lands", () => {
  const calls = { spawns: 0 };
  assert.throws(
    () => runUntilComplete(() => calls.spawns++, () => false, () => {}),
    /never completed/);
  assert.equal(calls.spawns, 3);
});
