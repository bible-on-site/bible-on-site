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

test("scans requested merge groups without reacting to their destruction", () => {
	assert.deepEqual(workflow.on.merge_group, { types: ["checks_requested"] });
});

test("retains PR, protected-branch and scheduled scans", () => {
	assert.deepEqual(workflow.on.push, { branches: ["master"] });
	assert.deepEqual(workflow.on.pull_request, { branches: ["master"] });
	assert.deepEqual(workflow.on.schedule, [{ cron: "27 3 * * 1" }]);
});

test("pull requests scan only the languages the router resolves (#3795)", () => {
	const detect = workflow.jobs.detect;
	assert.ok(detect, "the router detection job must exist");
	assert.equal(detect.if, "${{ github.event_name == 'pull_request' }}");
	assert.equal(detect["timeout-minutes"], 10);
	const step = detect.steps.find((step) =>
		step.run?.includes("determine-changes.ts"),
	);
	assert.ok(step, "detection must reuse the shared module router");
	const scope = detect.steps.find((step) => step.id === "scope");
	assert.ok(scope?.run.includes("matrix="), "scope step emits the matrix");
	assert.ok(
		scope.env?.LANGUAGES ===
			"${{ steps.detect.outputs.codeql_languages }}",
		"the matrix must consume the router's language scope",
	);
	assert.equal(
		detect.outputs.matrix,
		"${{ steps.scope.outputs.matrix }}",
	);

	const job = workflow.jobs.analyze;
	assert.deepEqual(job.needs, "detect");
	const include = job.strategy.matrix.include;
	assert.match(
		include,
		/github\.event_name == 'pull_request' && fromJSON\(needs\.detect\.outputs\.matrix\)/,
		"PRs use the router-scoped matrix",
	);
	// Non-PR events keep the full four-language fallback inside the same
	// expression — all of them scanning for real.
	for (const language of [
		"actions",
		"csharp",
		"javascript-typescript",
		"python",
	])
		assert.ok(
			include.includes(`"language":"${language}","build-mode":"none","scan":true`),
			`expected ${language} to scan in ${include}`,
		);
});

test("out-of-scope PR languages still report a result to code scanning (#3795)", () => {
	// The merge queue waits for a code-scanning analysis per configured
	// language category; a leg that skips the scan must upload an empty
	// result instead, or enqueue blocks forever "expecting results".
	const scope = workflow.jobs.detect.steps.find((step) => step.id === "scope");
	for (const language of [
		"actions",
		"csharp",
		"javascript-typescript",
		"python",
	])
		assert.ok(
			scope.run.includes(`"${language}"`),
			`the PR matrix must still cover ${language}`,
		);
	assert.ok(
		scope.run.includes("scan:"),
		"each leg carries a scan flag derived from the router scope",
	);

	const steps = workflow.jobs.analyze.steps;
	for (const step of steps.filter((step) =>
		["github/codeql-action/init@", "github/codeql-action/analyze@"].some(
			(action) => step.uses?.startsWith(action),
		),
	))
		assert.equal(step.if, "matrix.scan", `real analysis of ${step.name}`);

	const empty = steps.find((step) =>
		step.uses?.startsWith("github/codeql-action/upload-sarif@"),
	);
	assert.ok(empty, "skipped languages upload an empty result");
	assert.equal(empty.if, "${{ !matrix.scan }}");
	assert.equal(
		empty.with.category,
		"/language:${{ matrix.language }}",
		"the empty result must report the same category as the real scan",
	);
	assert.ok(empty.with.sarif_file.endsWith(".sarif.json"));
});

test("scans the default checked-out synthetic commit in each language", () => {
	const job = workflow.jobs.analyze;
	assert.equal(
		job.if,
		"${{ !cancelled() && (github.event_name != 'pull_request' || needs.detect.result == 'success') }}",
		"merge groups and pushes must override the skipped detect need",
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
	assert.equal(analyze.with.category, `/language:\${{ matrix.language }}`);
	assert.equal(analyze.with.ref, undefined);
	assert.equal(analyze.with.sha, undefined);
});

test("preserves merge-group concurrency, deadlines and permissions", () => {
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
