import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mergeExecTrees, mergeRunnerArtifacts, validateRunnerEvidence } from "./merge-runner-shards.mjs";

const sha = "a".repeat(40);
const timing = { status: "completed", exitCode: 0, elapsedMs: 400000, deadlineMs: 900000 };
const evidence = (test) => ({ test, platform: "ios", outcome: "passed" });
const part = (...ids) => ({ timing, evidence: ids.map(evidence) });
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

test("requires a disjoint successful union of every expected scenario", () => {
  assert.deepEqual([...validateRunnerEvidence([part("a", "b"), part("c")], ["a", "b", "c"])], ["a", "b", "c"]);
  assert.throws(() => validateRunnerEvidence([part("a"), part("b")], ["a", "b", "c"]), /missing=c/);
  assert.throws(() => validateRunnerEvidence([part("a"), part("a")], ["a"]), /overlap/);
  assert.throws(() => validateRunnerEvidence([part("a"), part("b")], ["a"]), /extra=b/);
});

test("a timed-out runner or failed scenario cannot publish a complete union", () => {
  assert.throws(() => validateRunnerEvidence([{ ...part("a"), timing: { status: "timed-out", exitCode: 124 } }, part("b")], ["a", "b"]), /did not finish/);
  assert.throws(() => validateRunnerEvidence([{ timing, evidence: [{ ...evidence("a"), outcome: "failed" }] }, part("b")], ["a", "b"]), /Unsuccessful/);
  assert.throws(() => validateRunnerEvidence([part("a")], ["a"]), /at least two/);
});

test("retains independent build hashes, startup coverage and both test attributions", () => {
  const merged = mergeExecTrees([tree("a", "hash-one"), tree("b", "hash-two")], sha, true);
  assert.deepEqual(Object.keys(merged.tests), ["a", "b"]);
  assert.equal(merged.modules.length, 2);
  assert.deepEqual(merged.shared.reasons, ["hash-one", "hash-two"]);
  assert.deepEqual(merged.shared.files, ["app/BibleOnSite/Startup.cs"]);
  assert.equal(merged.diagnostics.dumpsApplied, 2);
  assert.equal(merged.complete, true);
});

test("refuses execution evidence from another commit or an overlapping test", () => {
  assert.throws(() => mergeExecTrees([tree("a", "h1"), { ...tree("b", "h2"), snapshotSha: "b".repeat(40) }], sha, true), /snapshot SHA/);
  assert.throws(() => mergeExecTrees([tree("a", "h1"), tree("a", "h2")], sha, true), /overlap/);
});

test("merges LCOV by covered locations and preserves both startup dumps", () => {
  const root = mkdtempSync(join(tmpdir(), "runner-shards-"));
  try {
    const inputs = [join(root, "shard1"), join(root, "shard2")];
    for (const [index, input] of inputs.entries()) {
      mkdirSync(join(input, "coverage-evidence"), { recursive: true });
      mkdirSync(join(input, "app-coverage"), { recursive: true });
      mkdirSync(join(input, "coverage-app"), { recursive: true });
      const id = index === 0 ? "a" : "b";
      writeFileSync(join(input, "pilot-timing.json"), JSON.stringify(timing));
      writeFileSync(join(input, "coverage-evidence", `${id}.json`), JSON.stringify(evidence(id)));
      writeFileSync(join(input, "app-coverage", "_startup-passed.json"), JSON.stringify({ source: index }));
      writeFileSync(join(input, "exec-coverage-tree.json"), JSON.stringify(tree(id, `hash-${index}`)));
      writeFileSync(join(input, "coverage-app", "lcov.info"), `SF:/runner/app/BibleOnSite/X.cs\nDA:1,${index === 0 ? 1 : 0}\nDA:2,${index === 1 ? 1 : 0}\nend_of_record\n`);
    }
    assert.equal(mergeRunnerArtifacts(inputs, root, sha, ["a", "b"], ["a", "b"]), true);
    const lcov = readFileSync(join(root, "coverage-app", "lcov.info"), "utf8");
    assert.equal(lcov.match(/SF:/g).length, 1);
    assert.match(lcov, /DA:1,1/);
    assert.match(lcov, /DA:2,1/);
    assert.equal(JSON.parse(readFileSync(join(root, "app-coverage", "shard2-_startup-passed.json"), "utf8")).source, 1);
    assert.equal(mergeRunnerArtifacts(inputs, root, sha, ["a", "b"], ["a", "b", "c"]), false);
    assert.equal(JSON.parse(readFileSync(join(root, "runner-union.json"), "utf8")).complete, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("three runners retain every test and startup dump; a missing or failed third group cannot pass", () => {
  assert.deepEqual([...validateRunnerEvidence([part("a"), part("b"), part("c")], ["a", "b", "c"])], ["a", "b", "c"]);
  assert.throws(() => validateRunnerEvidence([part("a"), part("b")], ["a", "b", "c"]), /missing=c/);
  assert.throws(() => validateRunnerEvidence([part("a"), part("b"), { ...part("c"), timing: { status: "timed-out", exitCode: 124 } }], ["a", "b", "c"]), /did not finish/);
  const merged = mergeExecTrees([tree("a", "h1"), tree("b", "h2"), tree("c", "h3")], sha, true);
  assert.deepEqual(Object.keys(merged.tests), ["a", "b", "c"]);
  assert.equal(merged.diagnostics.dumpsApplied, 3);
  assert.equal(merged.modules.length, 3);
});
