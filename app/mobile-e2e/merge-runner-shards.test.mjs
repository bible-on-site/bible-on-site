import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverShardInputs, mergeExecTrees, mergeRunnerArtifacts, validateRunnerEvidence } from "./merge-runner-shards.mjs";

const sha = "a".repeat(40);
const timing = { status: "completed", exitCode: 0, elapsedMs: 400000, deadlineMs: 900000 };
const evidence = (test) => ({ test, platform: "ios", outcome: "passed" });
const part = (...ids) => ({ timing, evidence: ids.map(evidence) });
const plan = (...groups) => ({
  kind: "ios-shard-plan", schemaVersion: 1, suite: "app-mobile-e2e", platform: "ios",
  mode: "shadow", testedSha: sha, fingerprint: "fp",
  runSet: groups.flat().sort(),
  shards: groups.map((tests, index) => ({ shard: index + 1, tests, estimatedMs: 1000 })),
});
const caseManifest = (shard, tests, shards) => ({
  schemaVersion: 1, suite: "app-mobile-e2e", platform: "ios", selectAll: false,
  shard, shards, selected: tests.map((id) => ({ id, reasons: [] })),
});
function tree(id, hash) {
  return {
    kind: "exec-coverage-tree", schemaVersion: 1, suite: "app-mobile-e2e", platform: "ios",
    snapshotSha: sha, configuration: "Debug", collector: "altcover", collectorVersion: "9",
    envFingerprint: hash, collectedAtUtc: "2026-10-14T00:00:00Z", complete: false,
    modules: [{ name: "BibleOnSite", hash }], nodes: { "file:app/BibleOnSite/X.cs": { kind: "file", decl: "app/BibleOnSite/X.cs" } },
    tests: { [id]: { id, attribution: "per-test", measured: true, outcome: "passed", files: ["app/BibleOnSite/X.cs"] } },
    shared: { reasons: [hash], nodes: [], files: ["app/BibleOnSite/Startup.cs"] }, unmatchedEvidence: [],
    diagnostics: { attribution: "per-test", dumpsTotal: 1, dumpsApplied: 1, unknownPointIds: 0, errorDumps: [], incompatibleDumps: [], missingDumps: [] },
  };
}

test("requires a disjoint successful union of every planned scenario", () => {
  assert.deepEqual([...validateRunnerEvidence([part("a", "b"), part("c")], ["a", "b", "c"])], ["a", "b", "c"]);
  assert.throws(() => validateRunnerEvidence([part("a"), part("b")], ["a", "b", "c"]), /missing=c/);
  assert.throws(() => validateRunnerEvidence([part("a"), part("a")], ["a"]), /overlap/);
  assert.throws(() => validateRunnerEvidence([part("a"), part("b")], ["a"]), /extra=b/);
  assert.throws(() => validateRunnerEvidence([], ["a"]), /No iOS runners/);
});

test("a timed-out runner or failed scenario cannot publish a complete union", () => {
  assert.throws(() => validateRunnerEvidence([{ ...part("a"), timing: { status: "timed-out", exitCode: 124 } }, part("b")], ["a", "b"]), /did not finish/);
  assert.throws(() => validateRunnerEvidence([{ timing, evidence: [{ ...evidence("a"), outcome: "failed" }] }, part("b")], ["a", "b"]), /Unsuccessful/);
});

test("locates shard artifact directories by the shard number in their name", () => {
  const root = mkdtempSync(join(tmpdir(), "shard-inputs-"));
  try {
    for (const name of ["app-mobile-e2e-shard.7.ios-shard2", "app-mobile-e2e-shard.7.ios-shard1", "unrelated"]) {
      mkdirSync(join(root, name), { recursive: true });
    }
    const inputs = discoverShardInputs(root, plan(["a"], ["b", "c"]));
    assert.deepEqual(inputs.map((input) => input.split(/[\\/]/).pop()),
      ["app-mobile-e2e-shard.7.ios-shard1", "app-mobile-e2e-shard.7.ios-shard2"]);
    assert.throws(() => discoverShardInputs(root, plan(["a"], ["b"], ["c"])), /Missing artifacts for iOS shard 3/);
    mkdirSync(join(root, "app-mobile-e2e-shard.8.ios-shard1"), { recursive: true });
    assert.throws(() => discoverShardInputs(root, plan(["a"], ["b", "c"])), /Duplicate artifact/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retains independent build hashes, startup coverage and every test attribution", () => {
  const merged = mergeExecTrees([tree("a", "hash-one"), tree("b", "hash-two"), tree("c", "hash-three")], sha, true);
  assert.deepEqual(Object.keys(merged.tests), ["a", "b", "c"]);
  assert.equal(merged.modules.length, 3);
  assert.deepEqual(merged.shared.reasons, ["hash-one", "hash-three", "hash-two"].sort());
  assert.equal(merged.diagnostics.dumpsApplied, 3);
  assert.equal(merged.complete, true);
});

test("refuses execution evidence from another commit or an overlapping test", () => {
  assert.throws(() => mergeExecTrees([tree("a", "h1"), { ...tree("b", "h2"), snapshotSha: "b".repeat(40) }], sha, true), /snapshot SHA/);
  assert.throws(() => mergeExecTrees([tree("a", "h1"), tree("a", "h2")], sha, true), /overlap/);
});

// JUnit case ids are `classname.name` — the same xUnit FQN form the planner
// and the evidence records use.
function writeShardInput(input, shard, shards, ids, junitTimes) {
  mkdirSync(join(input, "coverage-evidence"), { recursive: true });
  mkdirSync(join(input, "app-coverage"), { recursive: true });
  mkdirSync(join(input, "coverage-app"), { recursive: true });
  mkdirSync(join(input, "results"), { recursive: true });
  writeFileSync(join(input, "pilot-timing.json"), JSON.stringify(timing));
  writeFileSync(join(input, "case-manifest.json"), JSON.stringify(caseManifest(shard, ids, shards)));
  for (const id of ids) {
    writeFileSync(join(input, "coverage-evidence", `${id}.json`), JSON.stringify(evidence(id)));
  }
  if (junitTimes) {
    writeFileSync(join(input, "results", "mobile-e2e.xml"),
      `<testsuite>${Object.entries(junitTimes).map(([name, seconds]) =>
        `<testcase classname="Suite.Pilot" name="${name}" time="${seconds}"/>`).join("")}</testsuite>`);
  }
  writeFileSync(join(input, "app-coverage", "_startup-passed.json"), JSON.stringify({ source: shard }));
  writeFileSync(join(input, "exec-coverage-tree.json"), JSON.stringify(tree(ids[0], `hash-${shard}`)));
  writeFileSync(join(input, "coverage-app", "lcov.info"), `SF:/runner/app/BibleOnSite/X.cs\nDA:1,${shard === 1 ? 1 : 0}\nDA:2,${shard === 2 ? 1 : 0}\nend_of_record\n`);
}

test("merges LCOV, timings and evidence across every planned shard", () => {
  const root = mkdtempSync(join(tmpdir(), "runner-shards-"));
  try {
    const inputs = [join(root, "shard1"), join(root, "shard2")];
    writeShardInput(inputs[0], 1, 2, ["Suite.Pilot.a"], { a: 30 });
    writeShardInput(inputs[1], 2, 2, ["Suite.Pilot.b"], { b: 50 });
    const shardPlan = plan(["Suite.Pilot.a"], ["Suite.Pilot.b"]);
    const { complete, overheadMs } = mergeRunnerArtifacts(inputs, root, sha, shardPlan,
      ["Suite.Pilot.a", "Suite.Pilot.b"]);
    assert.equal(complete, true);
    // 400s pilot − 30s of cases vs 400s − 50s → mean of 370s and 350s.
    assert.equal(overheadMs, 360_000);
    const lcov = readFileSync(join(root, "coverage-app", "lcov.info"), "utf8");
    assert.equal(lcov.match(/SF:/g).length, 1);
    assert.match(lcov, /DA:1,1/);
    assert.match(lcov, /DA:2,1/);
    assert.equal(JSON.parse(readFileSync(join(root, "app-coverage", "shard2-_startup-passed.json"), "utf8")).source, 2);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "case-timings.json"), "utf8")),
      { "Suite.Pilot.a": 30_000, "Suite.Pilot.b": 50_000 });
    const union = JSON.parse(readFileSync(join(root, "runner-union.json"), "utf8"));
    assert.equal(union.planFingerprint, "fp");
    assert.deepEqual(union.shards.map((shard) => [shard.shard, shard.observedMs]), [[1, 30_000], [2, 50_000]]);
    // A plan covering only part of the suite reports complete=false.
    const partial = mergeRunnerArtifacts(inputs, root, sha, shardPlan,
      ["Suite.Pilot.a", "Suite.Pilot.b", "Suite.Pilot.c"]);
    assert.equal(partial.complete, false);
    assert.equal(JSON.parse(readFileSync(join(root, "runner-union.json"), "utf8")).complete, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("merges three planned shards and tolerates a missing JUnit report", () => {
  const root = mkdtempSync(join(tmpdir(), "runner-shards-"));
  try {
    const inputs = [join(root, "shard1"), join(root, "shard2"), join(root, "shard3")];
    writeShardInput(inputs[0], 1, 3, ["Suite.Pilot.a"], { a: 30 });
    writeShardInput(inputs[1], 2, 3, ["Suite.Pilot.b"], { b: 50 });
    // No JUnit report on the third shard: durations fall back to evidence
    // spans — here none are timestamped, so the case is simply unmeasured.
    writeShardInput(inputs[2], 3, 3, ["Suite.Pilot.c"], null);
    const { complete, overheadMs } = mergeRunnerArtifacts(inputs, root, sha,
      plan(["Suite.Pilot.a"], ["Suite.Pilot.b"], ["Suite.Pilot.c"]),
      ["Suite.Pilot.a", "Suite.Pilot.b", "Suite.Pilot.c"]);
    assert.equal(complete, true);
    assert.equal(overheadMs, 360_000);
    const timings = JSON.parse(readFileSync(join(root, "case-timings.json"), "utf8"));
    assert.deepEqual(timings, { "Suite.Pilot.a": 30_000, "Suite.Pilot.b": 50_000 });
    const union = JSON.parse(readFileSync(join(root, "runner-union.json"), "utf8"));
    assert.equal(union.shards[2].observedMs, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails the merge when a shard ran a different manifest than planned", () => {
  const root = mkdtempSync(join(tmpdir(), "runner-shards-"));
  try {
    const inputs = [join(root, "shard1"), join(root, "shard2")];
    writeShardInput(inputs[0], 1, 2, ["Suite.Pilot.a"], { a: 30 });
    writeShardInput(inputs[1], 2, 2, ["Suite.Pilot.b"], { b: 50 });
    // A stale manifest — shard 2 claims it was assigned "z", not "b".
    writeFileSync(join(inputs[1], "case-manifest.json"), JSON.stringify(caseManifest(2, ["Suite.Pilot.z"], 2)));
    assert.throws(
      () => mergeRunnerArtifacts(inputs, root, sha,
        plan(["Suite.Pilot.a"], ["Suite.Pilot.b"]), ["Suite.Pilot.a", "Suite.Pilot.b"]),
      /did not run its assigned manifest/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
