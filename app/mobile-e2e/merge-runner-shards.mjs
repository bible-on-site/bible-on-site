import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeShardEvidence, mergeShardAppCoverage } from "./shards.mjs";
import { loadEvidence } from "../../devops/github/ci/e2e-impact/collect-appium.ts";
import { loadRules } from "../../devops/github/ci/e2e-impact/model.ts";
import { discoverSuiteTests } from "../../devops/github/ci/e2e-impact/xunit-discovery.ts";
import { junitDurations, evidenceDurations } from "../../devops/github/ci/e2e-impact/timings.ts";
import { canonicalize, sha256, validateExecTree } from "../../devops/e2e-coverage-trees/model.ts";
import { mergeLcovTexts } from "../../devops/merge-lcov.mts";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const union = (...arrays) => [...new Set(arrays.flat())].sort();

// Locates one downloaded artifact directory per planned shard, keyed by the
// shard number in its name (app-mobile-e2e-shard.<run>.ios-shard<N>).
export function discoverShardInputs(inputsDir, plan) {
  const byShard = new Map();
  for (const name of readdirSync(inputsDir)) {
    const match = /ios-shard(\d+)$/.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    if (byShard.has(index)) throw new Error(`Duplicate artifact for iOS shard ${index}.`);
    byShard.set(index, join(inputsDir, name));
  }
  return plan.shards.map((shard) => {
    const dir = byShard.get(shard.shard);
    if (dir === undefined) throw new Error(`Missing artifacts for iOS shard ${shard.shard}.`);
    return dir;
  });
}

// Independent runners may produce distinct instrumented module hashes.
// Execution evidence joins by source declaration; retain every module/hash
// and each shard's diagnostics instead of attaching dumps to another build.
export function mergeExecTrees(trees, snapshotSha, complete) {
  if (trees.length === 0) throw new Error("No iOS runner trees to merge.");
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

// Every shard must have finished its supervised pilot cleanly, produced only
// passing iOS evidence, and together cover the planned run set exactly once.
// A failed, timed-out or incomplete shard therefore fails the merge — the
// required check can never go green on a partial suite.
export function validateRunnerEvidence(parts, expectedIds) {
  if (parts.length === 0) throw new Error("No iOS runners to verify.");
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

// Per-case observed durations for one shard: the JUnit report's `time`
// (fixture init included — the cost a shard actually paid), or evidence
// spans when the run produced no report.
function shardDurations(input, evidence) {
  return junitDurations(join(input, "results", "mobile-e2e.xml")) ?? evidenceDurations(evidence);
}

export function mergeRunnerArtifacts(inputs, output, snapshotSha, plan, fullSuiteIds) {
  const parts = inputs.map((input) => ({
    timing: readJson(join(input, "pilot-timing.json")),
    evidence: loadEvidence(join(input, "coverage-evidence")),
  }));
  // The executed manifest in each shard's artifacts must be the assignment
  // the planner made — a rebuilt or stale manifest could otherwise smuggle
  // an extra or missing case past the union check below.
  inputs.forEach((input, index) => {
    const assignment = plan.shards[index];
    const executed = readJson(join(input, "case-manifest.json"));
    const executedIds = (executed.selected ?? []).map((entry) => entry.id).sort();
    if (executed.shard !== assignment.shard
      || canonicalize(executedIds) !== canonicalize(assignment.tests)) {
      throw new Error(`iOS shard ${assignment.shard} did not run its assigned manifest.`);
    }
  });
  const seen = validateRunnerEvidence(parts, plan.runSet);
  const complete = seen.size === fullSuiteIds.length && fullSuiteIds.every((id) => seen.has(id));

  // Timing evidence (#2263): merged per-case durations for the collector's
  // history update, and the mean of per-shard non-case pilot overhead —
  // elapsed minus measured case time — reported as `overhead-ms`.
  const caseTimings = {};
  const overheads = [];
  const shardReports = plan.shards.map((assignment, index) => {
    const durations = shardDurations(inputs[index], parts[index].evidence);
    const observedMs = assignment.tests.reduce((sum, id) => sum + (durations.get(id) ?? 0), 0);
    for (const [id, ms] of durations) caseTimings[id] = ms;
    // A shard with no measured durations cannot split pilot time between
    // cases and overhead — skipping it keeps its elapsed from being charged
    // wholly to setup.
    if (durations.size > 0) {
      const overhead = parts[index].timing.elapsedMs - [...durations.values()].reduce((a, b) => a + b, 0);
      if (overhead > 0) overheads.push(overhead);
    }
    return {
      shard: assignment.shard,
      tests: [...assignment.tests].sort(),
      estimatedMs: assignment.estimatedMs,
      observedMs: Math.round(observedMs),
      elapsedMs: parts[index].timing.elapsedMs,
    };
  });
  const overheadMs = overheads.length === 0 ? null
    : Math.round(overheads.reduce((a, b) => a + b, 0) / overheads.length);

  const tree = mergeExecTrees(inputs.map((input) => readJson(join(input, "exec-coverage-tree.json"))), snapshotSha, complete);
  mkdirSync(join(output, "coverage-app"), { recursive: true });
  mergeShardEvidence(inputs, join(output, "coverage-evidence"));
  mergeShardAppCoverage(inputs, join(output, "app-coverage"));
  writeFileSync(join(output, "case-timings.json"), JSON.stringify(caseTimings, null, 2));
  writeFileSync(join(output, "exec-coverage-tree.json"), JSON.stringify(tree, null, 2));
  const lcov = mergeLcovTexts(inputs.map((input) => readFileSync(join(input, "coverage-app", "lcov.info"), "utf8")), undefined, ["app/BibleOnSite/"]);
  if (!lcov.includes("SF:")) throw new Error("Combined iOS LCOV has no source records.");
  writeFileSync(join(output, "coverage-app", "lcov.info"), lcov);
  writeFileSync(join(output, "runner-union.json"), JSON.stringify({
    snapshotSha, complete, planFingerprint: plan.fingerprint,
    tests: [...seen].sort(), shards: shardReports,
    timings: parts.map((part) => part.timing),
  }, null, 2));
  return { complete, overheadMs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [outputArg, snapshotSha, ...rest] = process.argv.slice(2);
  const flags = new Map();
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith("--")) throw new Error(`Unexpected argument: ${rest[i]}`);
    flags.set(rest[i].slice(2), rest[++i]);
  }
  const inputsDir = flags.get("inputs");
  const planPath = flags.get("plan");
  if (!outputArg || !snapshotSha || !inputsDir || !planPath) {
    throw new Error("Usage: merge-runner-shards.mjs <output> <sha> --inputs <dir> --plan <ios-plan.json>");
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const rules = loadRules(join(root, "app/mobile-e2e/e2e-impact.json"));
  const full = discoverSuiteTests(root, rules.tests.root, rules.tests.glob, rules.tests.category)
    .filter((test) => test.platform.toLowerCase() === "ios" || test.platform === "Shared")
    .map((test) => test.id);
  const output = resolve(outputArg);
  const plan = readJson(planPath);
  if (plan.kind !== "ios-shard-plan" || plan.testedSha !== snapshotSha) {
    throw new Error("The iOS shard plan does not match this commit.");
  }
  const inputs = discoverShardInputs(resolve(inputsDir), plan);
  const { complete, overheadMs } = mergeRunnerArtifacts(inputs, output, snapshotSha, plan, full);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `complete=${complete}\n`);
    if (overheadMs !== null) appendFileSync(process.env.GITHUB_OUTPUT, `overhead-ms=${overheadMs}\n`);
  }
  console.log(`Merged ${inputs.length} iOS runners: ${plan.runSet.length} planned scenarios; full suite=${complete}.`);
}
