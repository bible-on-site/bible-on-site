import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { auditWorkflows, validateWorkflow } from "./workflow-timeouts.mjs";

const runner = (value) =>
	`jobs:\n  test:\n    runs-on: ubuntu-latest\n${value}\n    steps: []\n`;

for (const value of [
	"",
	"    timeout-minutes: 0",
	"    timeout-minutes: 61",
	"    timeout-minutes: 360",
	"    timeout-minutes: 1.5",
	'    timeout-minutes: "60"',
	`    timeout-minutes: \${{ inputs.timeout }}`,
]) {
	test(`rejects a missing or unbounded runner limit: ${value || "missing"}`, () => {
		assert.match(
			validateWorkflow(runner(value), "ci.yml")[0],
			/ci.yml: jobs.test: timeout-minutes/,
		);
	});
}

test("accepts tighter limits, matrix runners and the one-hour ceiling", () => {
	for (const limit of [1, 5, 10, 35, 60]) {
		assert.deepEqual(
			validateWorkflow(
				runner(`    timeout-minutes: ${limit}`).replace(
					"ubuntu-latest",
					`\${{ matrix.os }}`,
				),
				"ci.yml",
			),
			[],
		);
	}
});

test("a step timeout cannot substitute for a job timeout", () => {
	assert.equal(
		validateWorkflow(
			"jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: sleep 1\n        timeout-minutes: 5\n",
			"ci.yml",
		).length,
		1,
	);
});

test("accepts reusable-workflow callers and rejects invalid caller timeout fields", () => {
	const caller = "jobs:\n  call:\n    uses: ./.github/workflows/shared.yml\n";
	assert.deepEqual(validateWorkflow(caller, "ci.yml"), []);
	assert.match(
		validateWorkflow(`${caller}    timeout-minutes: 60\n`, "ci.yml")[0],
		/cap the called runner jobs/,
	);
});

test("rejects malformed YAML, duplicate keys, and invalid job mappings", () => {
	for (const source of [
		"jobs: [",
		"jobs: {}\njobs: {}",
		"name: no jobs",
		"jobs: []",
		"jobs:\n  test: []",
		"jobs:\n  test:\n    steps: []",
	]) {
		assert.ok(validateWorkflow(source, "broken.yml").length > 0, source);
	}
});

test("audits runner limits in reusable .yaml and .yml workflows, ignoring unrelated files", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "workflow-timeouts-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(
		join(directory, "caller.yml"),
		"jobs:\n  call:\n    uses: ./.github/workflows/shared.yaml\n",
	);
	writeFileSync(join(directory, "shared.yaml"), runner(""));
	writeFileSync(join(directory, "README.md"), "not YAML");
	assert.match(auditWorkflows(directory)[0], /shared.yaml: jobs.test/);
	const script = fileURLToPath(
		new URL("./workflow-timeouts.mjs", import.meta.url),
	);
	const failure = spawnSync(process.execPath, [script, directory], {
		encoding: "utf8",
	});
	assert.equal(failure.status, 1, failure.stderr);
	assert.match(failure.stderr, /shared.yaml: jobs.test/);
	writeFileSync(
		join(directory, "shared.yaml"),
		runner("    timeout-minutes: 60"),
	);
	assert.deepEqual(auditWorkflows(directory), []);
	const success = spawnSync(process.execPath, [script, directory], {
		encoding: "utf8",
	});
	assert.equal(success.status, 0, success.stderr);
	assert.match(success.stdout, /at most 60 minutes/);
});

test("every repository workflow runner has an explicit bounded timeout", () => {
	assert.deepEqual(
		auditWorkflows(
			fileURLToPath(new URL("../../../.github/workflows/", import.meta.url)),
		),
		[],
	);
	const result = spawnSync(
		process.execPath,
		[fileURLToPath(new URL("./workflow-timeouts.mjs", import.meta.url))],
		{ encoding: "utf8", cwd: tmpdir() },
	);
	assert.equal(result.status, 0, result.stderr);
});
