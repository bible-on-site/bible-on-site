import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mergeShardAppCoverage, mergeShardEvidence, shardRuns, SHARD_COUNT } from "./shards.mjs";

test("builds one run environment per shard with its own device, port, artifacts and filter", () => {
  const runs = shardRuns({
    MOBILE_UDID_SHARD_1: "udid-a",
    MOBILE_UDID_SHARD_2: "udid-b",
    MOBILE_PLATFORM: "iOS",
  }, "/artifacts/ios");
  assert.equal(runs.length, SHARD_COUNT);
  assert.equal(runs[0].env.MOBILE_UDID, "udid-a");
  assert.equal(runs[1].env.MOBILE_UDID, "udid-b");
  assert.equal(runs[0].env.MOBILE_APPIUM_PORT, "4723");
  assert.equal(runs[1].env.MOBILE_APPIUM_PORT, "4724");
  assert.equal(runs[0].env.MOBILE_WDA_PORT, "8100");
  assert.equal(runs[1].env.MOBILE_WDA_PORT, "8101");
  assert.equal(runs[0].env.MOBILE_E2E_COVERAGE_PORT, "4787");
  assert.equal(runs[1].env.MOBILE_E2E_COVERAGE_PORT, "4788");
  assert.equal(runs[0].env.MOBILE_E2E_ARTIFACTS, join("/artifacts/ios", "shard1"));
  assert.equal(runs[1].env.MOBILE_E2E_ARTIFACTS, join("/artifacts/ios", "shard2"));
  assert.equal(runs[0].env.MOBILE_E2E_SHARD, "1,3");
  assert.equal(runs[1].env.MOBILE_E2E_SHARD, "2");
  assert.equal(runs[0].env.MOBILE_PLATFORM, "iOS");
});

test("refuses a shard plan without every simulator UDID", () => {
  assert.throws(() => shardRuns({ MOBILE_UDID_SHARD_1: "udid-a" }, "/artifacts"),
    /MOBILE_UDID_SHARD_2/);
});

test("merges disjoint shard evidence into the top-level artifacts dir", () => {
  const root = mkdtempSync(join(tmpdir(), "shards-"));
  try {
    for (const [shard, files] of [["shard1", ["a-passed.json", "b-passed.json"]], ["shard2", ["c-passed.json"]]]) {
      const dir = join(root, shard, "coverage-evidence");
      mkdirSync(dir, { recursive: true });
      for (const file of files) writeFileSync(join(dir, file), `{"test":"${file}"}`);
    }
    const destination = join(root, "coverage-evidence");
    mergeShardEvidence([join(root, "shard1"), join(root, "shard2")], destination);
    assert.equal(readFileSync(join(destination, "a-passed.json"), "utf8"), '{"test":"a-passed.json"}');
    assert.equal(readFileSync(join(destination, "c-passed.json"), "utf8"), '{"test":"c-passed.json"}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails the merge when two shards produced the same evidence file", () => {
  const root = mkdtempSync(join(tmpdir(), "shards-"));
  try {
    for (const shard of ["shard1", "shard2"]) {
      const dir = join(root, shard, "coverage-evidence");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "shared-passed.json"), "{}");
    }
    assert.throws(
      () => mergeShardEvidence([join(root, "shard1"), join(root, "shard2")], join(root, "coverage-evidence")),
      /more than one shard/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clears stale merged evidence before merging a new run", () => {
  const root = mkdtempSync(join(tmpdir(), "shards-"));
  try {
    const destination = join(root, "coverage-evidence");
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "stale-passed.json"), "{}");
    const evidence = join(root, "shard1", "coverage-evidence");
    mkdirSync(evidence, { recursive: true });
    writeFileSync(join(evidence, "fresh-passed.json"), "{}");
    mergeShardEvidence([join(root, "shard1")], destination);
    assert.throws(() => readFileSync(join(destination, "stale-passed.json")));
    assert.equal(readFileSync(join(destination, "fresh-passed.json"), "utf8"), "{}");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preserves both simulator startup dumps and collection errors for the coverage apply step", () => {
  const root = mkdtempSync(join(tmpdir(), "shard-app-coverage-"));
  try {
    const inputs = [join(root, "shard1"), join(root, "shard2")];
    for (const [index, input] of inputs.entries()) {
      const source = join(input, "app-coverage");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "_startup-passed.json"), JSON.stringify({ module: index }));
      writeFileSync(join(source, "test.json.coverage-error.txt"), `failure ${index}`);
    }
    const output = join(root, "app-coverage");
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "stale.json"), "{}");
    mergeShardAppCoverage(inputs, output);
    assert.equal(readFileSync(join(output, "shard1-_startup-passed.json"), "utf8"), '{"module":0}');
    assert.equal(readFileSync(join(output, "shard2-_startup-passed.json"), "utf8"), '{"module":1}');
    assert.equal(readFileSync(join(output, "shard2-test.json.coverage-error.txt"), "utf8"), "failure 1");
    assert.throws(() => readFileSync(join(output, "stale.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
