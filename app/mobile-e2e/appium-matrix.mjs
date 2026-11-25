#!/usr/bin/env node
/**
 * Emits a platform's device-leg job matrix from its resolved shard plan
 * (#2263): one runner leg per planned shard. A plan with zero shards yields an
 * empty list — a legitimate empty selection expands to no legs and starts no
 * device. The matrix and shard count go to $GITHUB_OUTPUT; a markdown table
 * goes to the step summary.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function shardMatrix(plan) {
  if (plan?.kind !== "appium-shard-plan" || plan.schemaVersion !== 1 || !Array.isArray(plan.shards)) {
    throw new Error("Not a schema-1 appium-shard-plan.");
  }
  const seen = new Set();
  const shards = plan.shards.map((shard, index) => {
    if (!Number.isInteger(shard.shard) || shard.shard !== index + 1
      || !Array.isArray(shard.tests) || shard.tests.length === 0) {
      throw new Error(`Malformed shard entry at index ${index}.`);
    }
    for (const id of shard.tests) {
      if (seen.has(id)) throw new Error(`Case ${id} is assigned to more than one shard.`);
      seen.add(id);
    }
    return String(shard.shard);
  });
  return { shard: shards };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const planPath = process.argv[2];
  if (!planPath) throw new Error("Usage: appium-matrix.mjs <shard-plan.json>");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const matrix = shardMatrix(plan);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    appendFileSync(output, `matrix=${JSON.stringify(matrix)}\n`);
    appendFileSync(output, `shards=${plan.shards.length}\n`);
  }
  console.log(`${plan.platform} matrix: ${plan.shards.length} shard leg(s).`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(summary, [
      `### ${plan.platform} shard matrix`,
      "",
      "| leg | cases | estimated |",
      "| --- | --- | --- |",
      ...plan.shards.map((shard) =>
        `| ${plan.platform}-shard${shard.shard} | ${shard.tests.length} | ${(shard.estimatedMs / 60000).toFixed(1)}min |`),
    ].join("\n") + "\n");
  }
}
