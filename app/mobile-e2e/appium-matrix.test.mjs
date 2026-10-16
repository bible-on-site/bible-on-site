import assert from "node:assert/strict";
import { test } from "node:test";
import { shardMatrix } from "./appium-matrix.mjs";

const plan = (...groups) => ({
  kind: "ios-shard-plan", schemaVersion: 1, suite: "app-mobile-e2e", platform: "ios",
  mode: "shadow", testedSha: "a".repeat(40), fingerprint: "fp",
  runSet: groups.flat().sort(),
  shards: groups.map((tests, index) => ({ shard: index + 1, tests, estimatedMs: 60_000 })),
});

test("emits one shard value per planned iOS leg", () => {
  assert.deepEqual(shardMatrix(plan(["a", "b"], ["c"], ["d"])), { shard: ["1", "2", "3"] });
  assert.deepEqual(shardMatrix(plan(["a", "b"])), { shard: ["1"] });
});

test("a legitimately empty selection yields an empty matrix", () => {
  assert.deepEqual(shardMatrix(plan()), { shard: [] });
});

test("rejects malformed or overlapping plans instead of emitting a bad matrix", () => {
  assert.throws(() => shardMatrix({ kind: "other" }), /ios-shard-plan/);
  assert.throws(() => shardMatrix(plan(["a"], [])), /Malformed shard/);
  assert.throws(() => shardMatrix(plan(["a"], ["a"])), /more than one shard/);
  const nonContiguous = plan(["a"], ["b"]);
  nonContiguous.shards[1].shard = 5;
  assert.throws(() => shardMatrix(nonContiguous), /Malformed shard/);
});
