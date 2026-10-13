import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/app-mobile-e2e.yml", import.meta.url), "utf8");
function jobBudget(source, platform) {
  const value = source.match(/^    timeout-minutes:\s*(.+)$/m)?.[1];
  assert.ok(value, "The mobile job must have an explicit overall budget");
  if (/^\d+$/.test(value)) return Number(value);
  const conditional = value.match(/matrix\.platform == 'iOS' && (\d+) \|\| (\d+)/);
  assert.ok(conditional, "Account explicitly for the platform job budgets");
  return Number(conditional[platform === "iOS" ? 1 : 2]);
}
function pilotDeadline(source) {
  const block = source.match(/id: pilot-ios([\s\S]*?)(?=\n      - name:)/)?.[1];
  assert.ok(block, "Keep the required iOS pilot");
  return Number(block.match(/timeout-minutes:\s*(\d+)/)?.[1]);
}
test("the full iOS deadline leaves setup and diagnostic upload time", () => {
  // Current runs spent 19-22 minutes before the pilot. Reserve 30 for setup
  // plus ten for bounded native sampling, coverage and artifact uploads.
  assert.ok(jobBudget(workflow, "iOS") >= pilotDeadline(workflow) + 30 + 10);
});
test("iOS test scope and deadline stay unchanged", () => {
  assert.equal(pilotDeadline(workflow), 45);
  assert.match(workflow, /run: npm run test:sharded --prefix app\/mobile-e2e/);
});
test("Android retains its current whole-job deadline", () => {
  assert.equal(jobBudget(workflow, "Android"), 60);
});
test("the original shared 60-minute budget cannot satisfy the iOS contract", () => {
  const original = workflow.replace(/^    timeout-minutes:.*$/m, "    timeout-minutes: 60");
  assert.ok(jobBudget(original, "iOS") < pilotDeadline(original) + 30 + 10);
});
