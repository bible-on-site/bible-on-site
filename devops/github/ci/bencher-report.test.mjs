import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CHECK_LISTING_REREAD_MS, CHECK_LISTING_REREADS, createBencherIO, runBencherReport } from "./bencher-report.mjs";

const project = "bible-on-site-website";
const uuid = "01a1cef7-e731-770b-8c2f-0baa5aeb657e";
const projectUuid = "195472f4-ac23-48bb-a2a4-ba1ee2da6ff9";
const context = { project, branch: "fix/3258-webpack-instrumentation", testedSha: "a".repeat(40), checkSha: "b".repeat(40) };
const url = `https://bencher.dev/console/projects/${project}/reports/${uuid}`;
const fixture = () => ({
	uuid, project: { slug: project, uuid: projectUuid },
	branch: { name: context.branch, head: { version: { hash: context.testedSha } } },
	alerts: [], counts: { results: [{ benchmarks: 521, measures: 9, lines: 737 }], alerts: { total: 0 } },
});
const checkFixture = () => ({
	id: 42, head_sha: context.checkSha, app: { slug: "github-actions" },
	name: `Bencher Report (${project})`, status: "in_progress", conclusion: null,
	external_id: `bencher:${projectUuid}::t`,
});
function setup({ listings, before = [], after = [checkFixture()], report = fixture(), result, fetchError, updateError } = {}) {
	const updates = [];
	const delays = [];
	let reads = 0;
	const lists = listings ?? [before, after];
	return {
		updates,
		delays,
		reads: () => reads,
		io: {
			listChecks: () => lists[Math.min(reads++, lists.length - 1)],
			delay: (ms) => { delays.push(ms); return Promise.resolve(); },
			run: () => result ?? { status: 0, stdout: `other output\nView report: ${url}\n` },
			fetchReport: () => { if (fetchError) throw fetchError; return report; },
			updateCheck: (id, body) => { updates.push({ id, body }); if (updateError) throw updateError; return { id, ...body }; },
		},
	};
}

test("finalizes the #3276 zero-exit, zero-alert report instead of leaving its check running", async () => {
	const { io, updates } = setup();
	assert.deepEqual(await runBencherReport(context, io), { id: 42, conclusion: "success", repaired: true });
	assert.equal(updates[0].id, 42);
	assert.equal(updates[0].body.status, "completed");
	assert.equal(updates[0].body.details_url, url);
	assert.equal(updates[0].body.external_id, `bencher:${projectUuid}:${uuid}:t`);
	assert.ok(updates[0].body.output.summary.length < 1000);
});

test("preserves Bencher's alert failure when recovering a dangling check", async () => {
	const report = fixture();
	report.alerts = [{ status: "active" }];
	report.counts.alerts.total = 1;
	const { io, updates } = setup({ report });
	assert.equal((await runBencherReport(context, io)).conclusion, "failure");
	assert.equal(updates[0].body.conclusion, "failure");
});

test("accepts an already completed matching check without rewriting it", async () => {
	const check = { ...checkFixture(), status: "completed", conclusion: "success", external_id: `bencher:${projectUuid}:${uuid}:t` };
	const { io, updates } = setup({ after: [check] });
	assert.equal((await runBencherReport(context, io)).repaired, false);
	assert.deepEqual(updates, []);
});

test("reconciles a matching completed check the first post-invocation listing missed (#3739)", async () => {
	const check = { ...checkFixture(), status: "completed", conclusion: "success", external_id: `bencher:${projectUuid}:${uuid}:t` };
	const { io, updates } = setup({ listings: [[], [], [check]] });
	assert.deepEqual(await runBencherReport(context, io), { id: 42, conclusion: "success", repaired: false });
	assert.deepEqual(updates, []);
});

test("still finalizes a pending check that only appears on the second listing", async () => {
	const { io, updates } = setup({ listings: [[], [], [checkFixture()]] });
	assert.equal((await runBencherReport(context, io)).repaired, true);
	assert.equal(updates[0].body.external_id, `bencher:${projectUuid}:${uuid}:t`);
});

test("stays fail-closed when the second listing is still empty or ambiguous", async () => {
	for (const listings of [
		[[], [], []],
		[[], [], [checkFixture(), { ...checkFixture(), id: 43 }]],
	]) {
		const { io, updates } = setup({ listings });
		await assert.rejects(runBencherReport(context, io), /Expected one new Bencher check/);
		assert.deepEqual(updates, []);
	}
});

describe("runBencherReport", () => {
	describe("when the check-runs listing lags check creation", () => {
		test("reconciles a matching check that only becomes visible several listings later", async () => {
			const { io, updates } = setup({ listings: [[], [], [], [], [checkFixture()]] });
			assert.equal((await runBencherReport(context, io)).repaired, true);
			assert.equal(updates[0].body.external_id, `bencher:${projectUuid}:${uuid}:t`);
		});

		test("stops re-reading the listing once the check is visible", async () => {
			const attempt = setup({ listings: [[], [], [checkFixture()]] });
			await runBencherReport(context, attempt.io);
			assert.equal(attempt.reads(), 3);
			assert.deepEqual(attempt.delays, [CHECK_LISTING_REREAD_MS]);
		});

		test("declares the check missing only after exhausting the bounded rereads", async () => {
			const attempt = setup({ listings: [[], [], []] });
			await assert.rejects(runBencherReport(context, attempt.io), /Expected one new Bencher check for this invocation; found 0/);
			assert.equal(attempt.reads(), 2 + CHECK_LISTING_REREADS);
			assert.deepEqual(attempt.delays, Array(CHECK_LISTING_REREADS).fill(CHECK_LISTING_REREAD_MS));
			assert.deepEqual(attempt.updates, []);
		});
	});
});

test("rejects a second-listing completed check bound to a different report", async () => {
	const check = { ...checkFixture(), status: "completed", conclusion: "success",
		external_id: `bencher:${projectUuid}:02b2def8-f842-880c-9cbb-1cbb0bfc768f:t` };
	const { io, updates } = setup({ listings: [[], [], [check]] });
	await assert.rejects(runBencherReport(context, io), /disagrees with its report/);
	assert.deepEqual(updates, []);
});

test("rejects mismatched report evidence and closes only this invocation's pending check as failed", async () => {
	for (const mutate of [
		(report) => { report.uuid = "wrong"; },
		(report) => { report.project.slug = "other-project"; },
		(report) => { report.project.uuid = "other-uuid"; },
		(report) => { report.branch.name = "master"; },
		(report) => { report.branch.head.version.hash = "c".repeat(40); },
		(report) => { report.alerts = undefined; },
		(report) => { report.counts.alerts.total = 1; },
		(report) => { report.counts.results = []; },
	]) {
		const report = fixture(); mutate(report);
		const { io, updates } = setup({ report });
		await assert.rejects(runBencherReport(context, io), /evidence does not match/);
		assert.equal(updates[0].body.conclusion, "failure");
	}
});

test("ignores older pending checks and refuses missing, foreign or ambiguous new checks", async () => {
	const old = { ...checkFixture(), id: 1 };
	const { io, updates } = setup({ before: [old], after: [old, checkFixture()] });
	await runBencherReport(context, io);
	assert.deepEqual(updates.map((update) => update.id), [42]);
	for (const after of [[], [old], [{ ...checkFixture(), head_sha: "other" }],
		[{ ...checkFixture(), app: { slug: "other-app" } }],
		[checkFixture(), { ...checkFixture(), id: 43 }]]) {
		const attempt = setup({ before: [old], after });
		await assert.rejects(runBencherReport(context, attempt.io), /Expected one new Bencher check/);
		assert.deepEqual(attempt.updates, []);
	}
});

test("exposes CLI failure, missing/foreign report URLs and report API failure", async () => {
	for (const options of [
		{ result: { status: 1, stdout: "failed" } },
		{ result: { status: 0, stdout: "no report" } },
		{ result: { status: 0, stdout: `View report: ${url.replace("bencher.dev", "untrusted.example")}` } },
		{ fetchError: new Error("Bencher report API returned HTTP 503") },
	]) {
		const { io, updates } = setup(options);
		await assert.rejects(runBencherReport(context, io));
		assert.equal(updates[0].body.conclusion, "failure");
	}
});

test("surfaces a failed GitHub completion without retrying or reporting success", async () => {
	const { io, updates } = setup({ updateError: new Error("GitHub HTTP 422") });
	await assert.rejects(runBencherReport(context, io), /GitHub HTTP 422/);
	assert.equal(updates.length, 1);
});

test("preserves a CLI launch failure when no GitHub check was created", async () => {
	const { io, updates } = setup({ after: [], result: { status: null, error: new Error("ENOENT") } });
	await assert.rejects(runBencherReport(context, io), /Bencher command failed \(ENOENT\)/);
	assert.deepEqual(updates, []);
});

test("refuses to overwrite a completed check that disagrees with the report", async () => {
	const check = { ...checkFixture(), status: "completed", conclusion: "failure" };
	const { io, updates } = setup({ after: [check] });
	await assert.rejects(runBencherReport(context, io), /disagrees with its report/);
	assert.deepEqual(updates, []);
});

test("rejects a GitHub acknowledgement that still leaves the check pending", async () => {
	const { io } = setup();
	io.updateCheck = () => checkFixture();
	await assert.rejects(runBencherReport(context, io), /did not acknowledge/);
});

test("binds the platform adapter to the PR head, paginated checks and the exact CLI arguments", async () => {
	const calls = [], output = [], errors = [];
	const io = createBencherIO(context, {
		repository: "owner/repo", command: "bencher", args: ["run", "--file", "a file.json"],
		exec: (command, args, options) => {
			calls.push({ command, args, input: options.input });
			return args.includes("PATCH") ? JSON.stringify({ id: 42, status: "completed" })
				: JSON.stringify([{ check_runs: [checkFixture()] }, { check_runs: [{ id: 99 }] }]);
		},
		spawn: (command, args) => {
			assert.equal(command, "bencher");
			assert.deepEqual(args, ["run", "--file", "a file.json"]);
			return { status: 0, stdout: "report output", stderr: "report warning" };
		},
		fetchReport: (address, options) => {
			assert.equal(address, `https://api.bencher.dev/v0/projects/${project}/reports/${uuid}`);
			assert.equal(options.redirect, "error");
			return { ok: true, json: () => fixture() };
		},
		stdout: { write: (value) => output.push(value) }, stderr: { write: (value) => errors.push(value) },
		delay: () => "real delay",
	});
	assert.equal(io.delay(), "real delay");
	assert.deepEqual(io.listChecks().map((check) => check.id), [42, 99]);
	assert.ok(calls[0].args[1].includes(`/commits/${context.checkSha}/check-runs`));
	assert.ok(calls[0].args.includes("--paginate"));
	assert.equal(io.run().status, 0);
	assert.deepEqual(output, ["report output"]);
	assert.deepEqual(errors, ["report warning"]);
	assert.deepEqual(await io.fetchReport(uuid), fixture());
	io.updateCheck(42, { status: "completed" });
	assert.ok(calls[1].args.includes("repos/owner/repo/check-runs/42"));
	assert.equal(calls[1].input, JSON.stringify({ status: "completed" }));
});

test("propagates HTTP and subprocess failures from the platform adapter", async () => {
	const io = createBencherIO(context, {
		repository: "owner/repo", command: "bencher", args: [],
		exec: () => { throw new Error("GitHub HTTP 403"); },
		spawn: () => ({ status: null, error: new Error("ENOENT") }),
		fetchReport: () => ({ ok: false, status: 503 }),
		stdout: { write: () => {} }, stderr: { write: () => {} },
	});
	assert.throws(() => io.listChecks(), /GitHub HTTP 403/);
	assert.throws(() => io.updateCheck(42, {}), /GitHub HTTP 403/);
	assert.equal(io.run().error.message, "ENOENT");
	await assert.rejects(io.fetchReport(uuid), /HTTP 503/);
});
