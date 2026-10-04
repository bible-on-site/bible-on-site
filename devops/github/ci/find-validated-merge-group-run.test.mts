import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type GitHubGet,
	baselineCopies,
	findValidatedMergeGroupRun,
	queueBaseSha,
} from "./find-validated-merge-group-run.ts";

// Recorded from push run 37208863885, which re-tested what merge_group run 37207817990 had passed.
const sha = "21e328ab6121871262a59749cee39f84e95dbd60";
const before = "9b067db7149ff7b20f4092217345fbeaa5127a5c";
const queueRun = {
	id: 37207817990,
	event: "merge_group",
	head_sha: sha,
	head_branch: `gh-readonly-queue/master/pr-1938-${before}`,
	status: "completed",
	conclusion: "success",
};
const masterNames = [
	"website-coverage.master",
	"api-coverage.master",
	"app-coverage.master",
	"admin-coverage.master",
	"bulletin-coverage.master",
	"data-coverage.master",
	"perushim-data-sql.master",
	"perushim-notes-sqlite.master",
];

function api(runs: object[], gate = "success"): { get: GitHubGet; paths: string[] } {
	const paths: string[] = [];
	const get: GitHubGet = async (apiPath) => {
		paths.push(apiPath);
		if (apiPath.startsWith("actions/workflows/")) return { workflow_runs: runs };
		return {
			jobs: [
				{ name: "Website CI", conclusion: "success" },
				{ name: "Cross Module CI", conclusion: gate },
			],
		};
	};
	return { get, paths };
}

const lookup = (get: GitHubGet, eventName: string | undefined = "push", headBefore = before) =>
	findValidatedMergeGroupRun({ eventName, sha, before: headBefore, workflowFile: "ci.yml", get });

describe("findValidatedMergeGroupRun", () => {
	it("finds the merge-queue run that fast-forwarded master", async () => {
		const { get, paths } = api([queueRun]);
		assert.equal(await lookup(get), 37207817990);
		assert.deepEqual(paths, [
			`actions/workflows/ci.yml/runs?event=merge_group&head_sha=${sha}&per_page=100&page=1`,
			"actions/runs/37207817990/jobs?filter=latest&per_page=100&page=1",
		]);
	});

	it("runs the tests when the queue run failed, is still running or was cancelled", async () => {
		for (const run of [
			{ ...queueRun, conclusion: "failure" },
			{ ...queueRun, status: "in_progress", conclusion: null },
			{ ...queueRun, conclusion: "cancelled" },
		]) {
			assert.equal(await lookup(api([run]).get), undefined);
		}
	});

	it("runs the tests when the queue run's gate did not pass", async () => {
		assert.equal(await lookup(api([queueRun], "skipped").get), undefined);
	});

	it("runs the tests when the queue run tested the commit on another base", async () => {
		assert.equal(await lookup(api([queueRun]).get, "push", "0".repeat(40)), undefined);
	});

	it("runs the tests when no queue run exists", async () => {
		assert.equal(await lookup(api([]).get), undefined);
	});

	it("never skips outside of push events", async () => {
		const { get, paths } = api([queueRun]);
		for (const eventName of ["workflow_dispatch", "merge_group", "pull_request"]) {
			assert.equal(await lookup(get, eventName), undefined);
		}
		assert.equal(
			await findValidatedMergeGroupRun({ eventName: undefined, sha, before, workflowFile: "ci.yml", get }),
			undefined,
		);
		assert.deepEqual(paths, []);
	});
});

describe("baselineCopies", () => {
	it("copies the queue run's workflow artifacts under the master baseline names", () => {
		// Artifact names recorded from merge_group run 37207817990.
		const artifacts = [
			"website-coverage.37207817990",
			"website-coverage.master",
			"api-coverage.37207817990",
			"app-coverage.37207817990",
			"admin-coverage.37207817990",
			"bulletin-coverage.37207817990",
			"data-coverage.37207817990",
			"perushim-data-sql",
			"perushim-notes-sqlite.37207817990",
			"website-e2e-report",
		].map((name) => ({ name, expired: false }));
		assert.deepEqual(baselineCopies(37207817990, artifacts, masterNames), [
			{ source: "website-coverage.37207817990", target: "website-coverage.master" },
			{ source: "api-coverage.37207817990", target: "api-coverage.master" },
			{ source: "app-coverage.37207817990", target: "app-coverage.master" },
			{ source: "admin-coverage.37207817990", target: "admin-coverage.master" },
			{ source: "bulletin-coverage.37207817990", target: "bulletin-coverage.master" },
			{ source: "data-coverage.37207817990", target: "data-coverage.master" },
			{ source: "perushim-data-sql", target: "perushim-data-sql.master" },
			{ source: "perushim-notes-sqlite.37207817990", target: "perushim-notes-sqlite.master" },
		]);
	});

	it("keeps the restored baseline for modules the queue run did not test", () => {
		const artifacts = [
			{ name: "api-coverage.1", expired: false },
			{ name: "app-coverage.1", expired: true },
		];
		assert.deepEqual(baselineCopies(1, artifacts, masterNames), [
			{ source: "api-coverage.1", target: "api-coverage.master" },
		]);
	});

	it("rejects names that are not master baselines", () => {
		assert.throws(() => baselineCopies(1, [], ["api-coverage.123"]), /not a \.master baseline/);
	});
});

describe("queueBaseSha", () => {
	it("reads the base commit from merge-queue branches only", () => {
		assert.equal(queueBaseSha(queueRun.head_branch), before);
		assert.equal(queueBaseSha("master"), undefined);
		assert.equal(queueBaseSha(null), undefined);
	});
});
