import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseDocument } from "yaml";

const document = parseDocument(
	readFileSync(
		new URL("../../../.github/workflows/codeql.yml", import.meta.url),
		"utf8",
	),
);
assert.deepEqual(document.errors, []);
const workflow = document.toJS();

test("CodeQL scans a newly requested merge group, without reacting to its destruction", () => {
	assert.deepEqual(workflow.on.merge_group, { types: ["checks_requested"] });
});

test("merge-group scanning retains PR, protected-branch and scheduled scans", () => {
	assert.deepEqual(workflow.on.push, { branches: ["master"] });
	assert.deepEqual(workflow.on.pull_request, { branches: ["master"] });
	assert.deepEqual(workflow.on.schedule, [{ cron: "27 3 * * 1" }]);
});

test("each merge-group language scans the default checked-out synthetic commit", () => {
	const job = workflow.jobs.analyze;
	assert.equal(
		job.if,
		undefined,
		"no PR-only job guard may exclude merge groups",
	);
	assert.deepEqual(
		job.strategy.matrix.include.map(
			({ language, "build-mode": buildMode }) => ({
				language,
				buildMode,
			}),
		),
		[
			{ language: "actions", buildMode: "none" },
			{ language: "csharp", buildMode: "none" },
			{ language: "javascript-typescript", buildMode: "none" },
			{ language: "python", buildMode: "none" },
		],
	);
	const checkout = job.steps.find((step) =>
		step.uses?.startsWith("actions/checkout@"),
	);
	assert.ok(checkout);
	assert.equal(checkout.if, undefined);
	assert.equal(
		checkout.with?.ref,
		undefined,
		"checkout must use the event SHA",
	);
	const analyze = job.steps.find((step) =>
		step.uses?.startsWith("github/codeql-action/analyze@"),
	);
	assert.ok(analyze);
	assert.equal(analyze.if, undefined);
	assert.equal(analyze.with.category, `/language:\${{ matrix.language }}`);
	assert.equal(analyze.with.ref, undefined);
	assert.equal(analyze.with.sha, undefined);
});

test("merge groups retain isolated concurrency, bounded execution and existing permissions", () => {
	assert.equal(
		workflow.concurrency.group,
		`codeql-\${{ github.workflow }}-\${{ github.ref }}`,
	);
	assert.equal(
		workflow.concurrency["cancel-in-progress"],
		`\${{ github.event_name == 'pull_request' }}`,
	);
	assert.equal(workflow.jobs.analyze["timeout-minutes"], 60);
	assert.equal(workflow.permissions, undefined);
	assert.deepEqual(workflow.jobs.analyze.permissions, {
		"security-events": "write",
		packages: "read",
		actions: "read",
		contents: "read",
	});
});
