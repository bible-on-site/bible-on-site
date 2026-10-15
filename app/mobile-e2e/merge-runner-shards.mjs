import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeShardEvidence, mergeShardAppCoverage } from "./shards.mjs";
import { loadEvidence } from "../../devops/github/ci/e2e-impact/collect-appium.ts";
import { loadRules } from "../../devops/github/ci/e2e-impact/model.ts";
import { discoverSuiteTests } from "../../devops/github/ci/e2e-impact/xunit-discovery.ts";
import { canonicalize, sha256, validateExecTree } from "../../devops/e2e-coverage-trees/model.ts";
import { mergeLcovTexts } from "../../devops/merge-lcov.mts";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const union = (...arrays) => [...new Set(arrays.flat())].sort();

// Independent runners may produce distinct instrumented module hashes.
// Execution evidence joins by source declaration; retain every module/hash
// and each shard's diagnostics instead of attaching dumps to another build.
export function mergeExecTrees(trees, snapshotSha, complete) {
  if (trees.length < 2) throw new Error("Expected at least two iOS runner trees.");
  const result = structuredClone(trees[0]);
  result.nodes = {};
  result.tests = {};
  for (const tree of trees) {
    const error = validateExecTree(tree, { suite: "app-mobile-e2e", platform: "ios" });
    if (error || tree.snapshotSha !== snapshotSha) {
      throw new Error(`Incompatible iOS execution tree: ${error ?? "snapshot SHA"}`);
    }
    for (const [id, node] of Object.entries(tree.nodes)) {
      const prior = result.nodes[id];
      if (prior && (prior.kind !== node.kind || prior.decl !== node.decl)) {
        throw new Error(`Conflicting source declaration: ${id}`);
      }
      result.nodes[id] = prior ? {
        ...prior,
        files: union(prior.files ?? [], node.files ?? []),
        parents: union(prior.parents ?? [], node.parents ?? []),
        ...(prior.span && node.span ? {
          span: [Math.min(prior.span[0], node.span[0]), Math.max(prior.span[1], node.span[1])],
        } : {}),
      } : node;
    }
    for (const [id, test] of Object.entries(tree.tests)) {
      if (result.tests[id]) throw new Error(`Execution coverage overlap: ${id}`);
      result.tests[id] = test;
    }
  }
  result.complete = complete;
  result.collectedAtUtc = new Date().toISOString();
  result.modules = [...new Map(trees.flatMap((tree) => tree.modules)
    .map((module) => [canonicalize(module), module])).values()];
  result.envFingerprint = sha256(trees.map((tree) => tree.envFingerprint).sort());
  result.shared = {
    reasons: union(...trees.map((tree) => tree.shared.reasons)),
    nodes: union(...trees.map((tree) => tree.shared.nodes)),
    files: union(...trees.map((tree) => tree.shared.files)),
  };
  result.unmatchedEvidence = union(...trees.map((tree) => tree.unmatchedEvidence));
  result.diagnostics = {
    attribution: trees.every((tree) => tree.diagnostics.attribution === "per-test") ? "per-test" : "mixed",
    dumpsTotal: trees.reduce((sum, tree) => sum + tree.diagnostics.dumpsTotal, 0),
    dumpsApplied: trees.reduce((sum, tree) => sum + tree.diagnostics.dumpsApplied, 0),
    unknownPointIds: trees.reduce((sum, tree) => sum + tree.diagnostics.unknownPointIds, 0),
    errorDumps: union(...trees.map((tree) => tree.diagnostics.errorDumps)),
    incompatibleDumps: union(...trees.map((tree) => tree.diagnostics.incompatibleDumps)),
    missingDumps: union(...trees.map((tree) => tree.diagnostics.missingDumps)),
  };
  return result;
}

export function validateRunnerEvidence(parts, expectedIds) {
  if (parts.length < 2) throw new Error("Expected at least two independent iOS runners.");
  const seen = new Set();
  for (const part of parts) {
    if (part.timing.status !== "completed" || part.timing.exitCode !== 0) {
      throw new Error("An iOS runner did not finish its supervised pilot.");
    }
    for (const record of part.evidence) {
      if (record.platform !== "ios" || record.outcome !== "passed") {
        throw new Error(`Unsuccessful iOS evidence: ${record.test}`);
      }
      if (seen.has(record.test)) throw new Error(`Scenario overlap: ${record.test}`);
      seen.add(record.test);
    }
  }
  const expected = new Set(expectedIds);
  const missing = [...expected].filter((id) => !seen.has(id));
  const extra = [...seen].filter((id) => !expected.has(id));
  if (missing.length || extra.length) {
    throw new Error(`iOS runner union mismatch: missing=${missing.join(",")} extra=${extra.join(",")}`);
  }
  return seen;
}

export function mergeRunnerArtifacts(inputs, output, snapshotSha, expectedIds, fullSuiteIds) {
  const parts = inputs.map((input) => ({
    timing: readJson(join(input, "pilot-timing.json")),
    evidence: loadEvidence(join(input, "coverage-evidence")),
  }));
  const seen = validateRunnerEvidence(parts, expectedIds);
  const complete = seen.size === fullSuiteIds.length && fullSuiteIds.every((id) => seen.has(id));
  const tree = mergeExecTrees(inputs.map((input) => readJson(join(input, "exec-coverage-tree.json"))), snapshotSha, complete);
  mkdirSync(join(output, "coverage-app"), { recursive: true });
  mergeShardEvidence(inputs, join(output, "coverage-evidence"));
  mergeShardAppCoverage(inputs, join(output, "app-coverage"));
  writeFileSync(join(output, "exec-coverage-tree.json"), JSON.stringify(tree, null, 2));
  const lcov = mergeLcovTexts(inputs.map((input) => readFileSync(join(input, "coverage-app", "lcov.info"), "utf8")), undefined, ["app/BibleOnSite/"]);
  if (!lcov.includes("SF:")) throw new Error("Combined iOS LCOV has no source records.");
  writeFileSync(join(output, "coverage-app", "lcov.info"), lcov);
  writeFileSync(join(output, "runner-union.json"), JSON.stringify({ snapshotSha, complete, tests: [...seen].sort(), timings: parts.map((part) => part.timing) }, null, 2));
  return complete;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [outputArg, snapshotSha, mode = "shadow"] = process.argv.slice(2);
  if (!outputArg || !snapshotSha) throw new Error("Usage: merge-runner-shards.mjs <output> <sha> [shadow|enforce]");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const rules = loadRules(join(root, "app/mobile-e2e/e2e-impact.json"));
  const full = discoverSuiteTests(root, rules.tests.root, rules.tests.glob, rules.tests.category)
    .filter((test) => test.platform.toLowerCase() === "ios" || test.platform === "Shared")
    .map((test) => test.id);
  const output = resolve(outputArg);
  const inputs = ["shard1", "shard2", "shard3"].map(shard => join(output, shard));
  let expected = full;
  if (mode === "enforce") {
    const manifests = inputs.map((input) => readJson(join(input, "selection-manifest.json")));
    if (manifests.some(manifest => canonicalize(manifest) !== canonicalize(manifests[0]))) throw new Error("iOS selection manifests differ.");
    if (!manifests[0].selectAll) expected = manifests[0].selected;
  }
  const complete = mergeRunnerArtifacts(inputs, output, snapshotSha, expected, full);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `complete=${complete}\n`);
  console.log(`Merged all three iOS runners: ${expected.length} passed scenarios; full suite=${complete}.`);
}