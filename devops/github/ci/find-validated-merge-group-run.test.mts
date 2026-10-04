import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	type Artifact,
	type BaselineProducers,
	type GitHubGet,
	type Job,
	findReusableMergeGroupRun,
	queueBaseSha,
	requiredBaselineCopies,
} from "./find-validated-merge-group-run.ts";

// Recorded from push run 37208863885, which re-tested what merge_group run 37207817990 had passed.
const sha = "21e328ab6121871262a59749cee39f84e95dbd60";
const before = "9b067db7149ff7b20f4092217345fbeaa5127a5c";
const runId = 37207817990;
const queueRun = {
	id: runId,
	event: "merge_group",
	head_sha: sha,
	head_branch: `gh-readonly-queue/master/pr-1938-${before}`,
	status: "completed",
	conclusion: "success",
};
const producers: BaselineProducers = {
	"Website CI": ["website-coverage.master"],
	"API CI": ["api-coverage.master"],
	"App CI": ["app-coverage.master"],
	"Admin CI": ["admin-coverage.master"],
	"Bulletin CI": ["bulletin-coverage.master"],
	"Data CI": ["data-coverage.master"],
	"Perushim Data": ["perushim-data-sql.master", "perushim-notes-sqlite.master"],
};
const recordedJobs: Job[] = [
	{ name: "API CI", conclusion: "success" },
	{ name: "Admin CI", conclusion: "success" },
	{ name: "Bulletin CI", conclusion: "success" },
	{ name: "Data CI", conclusion: "success" },
	{ name: "App CI", conclusion: "success" },
	{ name: "Website CI", conclusion: "success" },
	{ name: "Website Performance", conclusion: "success" },
	{ name: "Perushim Data", conclusion: "skipped" },
	{ name: "Cross Module CI", conclusion: "success" },
];
const recordedArtifacts: Artifact[] = [
	"app-coverage.37207817990",
	"api-coverage.master",
	"perushim-data-sql.master",
	"bulletin-coverage.37207817990",
	"website-coverage.37207817990",
	"admin-coverage.37207817990",
	"api-coverage.37207817990",
	"website-coverage.master",
	"data-coverage.37207817990",
	"perushim-notes-sqlite.master",
	"api-unit-junit-report-37207817990",
].map((name) => ({ name, expired: false }));
const recordedCopies = ["api", "admin", "bulletin", "data", "app", "website"].map((module) => ({
	source: `${module}-coverage.${runId}`,
	target: `${module}-coverage.master`,
}));

function api(
	runs: object[],
	jobs: Job[] = recordedJobs,
	artifacts: Artifact[] = recordedArtifacts,
): { get: GitHubGet; paths: string[] } {
	const paths: string[] = [];
	const get: GitHubGet = async (apiPath) => {
		paths.push(apiPath);
		if (apiPath.startsWith("actions/workflows/")) return { workflow_runs: runs };
		if (apiPath.includes("/jobs?")) return { jobs };
		return { artifacts };
	};
	return { get, paths };
}

const lookup = (get: GitHubGet, eventName: string | undefined, headBefore = before) =>
	findReusableMergeGroupRun({
		eventName,
		sha,
		before: headBefore,
		workflowFile: "ci.yml",
		producers,
		get,
	});

const withJob = (name: string, conclusion: string): Job[] =>
	recordedJobs.map((job) => (job.name === name ? { name, conclusion } : job));

describe("findReusableMergeGroupRun", () => {
	it("reuses the successful queue run that tested this exact fast-forward", async () => {
		const { get, paths } = api([queueRun]);
		assert.deepEqual(await lookup(get, "push"), { runId, copies: recordedCopies });
		assert.equal(
			paths[0],
			`actions/workflows/ci.yml/runs?event=merge_group&head_sha=${sha}&per_page=100&page=1`,
		);
	});

	for (const [status, conclusion] of [
		["completed", "failure"],
		["completed", "cancelled"],
		["in_progress", null],
	]) {
		it(`does not reuse a ${status}/${conclusion} queue run`, async () => {
			assert.ok("reason" in (await lookup(api([{ ...queueRun, status, conclusion }]).get, "push")));
		});
	}

	it("does not reuse a run whose Cross Module CI did not pass", async () => {
		assert.ok("reason" in (await lookup(api([queueRun], withJob("Cross Module CI", "failure")).get, "push")));
	});

	it("does not reuse a queue run built on a different master", async () => {
		assert.ok("reason" in (await lookup(api([queueRun]).get, "push", "0".repeat(40))));
	});

	it("does not reuse when no queue run exists", async () => {
		assert.ok("reason" in (await lookup(api([]).get, "push")));
	});

	it("does not reuse when more than one successful queue run matches", async () => {
		const result = await lookup(api([queueRun, { ...queueRun, id: runId + 1 }]).get, "push");
		assert.deepEqual(result, { reason: `2 successful merge-queue runs match ${sha} on ${before}` });
	});

	it("does not reuse when a job that ran left no fresh output", async () => {
		const artifacts = recordedArtifacts.filter((a) => a.name !== `data-coverage.${runId}`);
		const result = await lookup(api([queueRun], recordedJobs, artifacts).get, "push");
		assert.deepEqual(result, {
			reason: `merge-queue run ${runId} has no unexpired Data CI output for data-coverage.master`,
		});
	});

	it("does not reuse when a job's fresh output expired", async () => {
		const artifacts = recordedArtifacts.map((a) =>
			a.name === `app-coverage.${runId}` ? { ...a, expired: true } : a,
		);
		assert.ok("reason" in (await lookup(api([queueRun], recordedJobs, artifacts).get, "push")));
	});

	it("does not reuse when Perushim Data ran but its notes are unavailable", async () => {
		const jobs = withJob("Perushim Data", "success");
		const artifacts = [...recordedArtifacts, { name: "perushim-data-sql", expired: false }];
		const result = await lookup(api([queueRun], jobs, artifacts).get, "push");
		assert.deepEqual(result, {
			reason: `merge-queue run ${runId} has no unexpired Perushim Data output for perushim-notes-sqlite.master`,
		});
	});

	it("does not query the API for other events", async () => {
		for (const event of ["pull_request", "merge_group", "workflow_dispatch", undefined]) {
			const { get, paths } = api([queueRun]);
			assert.ok("reason" in (await lookup(get, event)));
			assert.deepEqual(paths, []);
		}
	});
});

describe("requiredBaselineCopies", () => {
	it("copies both fresh perushim outputs when Perushim Data ran", () => {
		const artifacts = [
			{ name: "perushim-data-sql", expired: false },
			{ name: `perushim-notes-sqlite.${runId}`, expired: false },
		];
		const jobs = [{ name: "Perushim Data", conclusion: "success" }];
		assert.deepEqual(requiredBaselineCopies(runId, jobs, artifacts, producers), [
			{ source: "perushim-data-sql", target: "perushim-data-sql.master" },
			{ source: `perushim-notes-sqlite.${runId}`, target: "perushim-notes-sqlite.master" },
		]);
	});

	it("carries forward baselines of jobs that did not run", () => {
		const jobs = [{ name: "Admin CI", conclusion: "skipped" }];
		assert.deepEqual(requiredBaselineCopies(runId, jobs, [], producers), []);
	});

	it("rejects non-master baseline names", () => {
		const jobs = [{ name: "Website CI", conclusion: "success" }];
		assert.throws(() => requiredBaselineCopies(runId, jobs, [], { "Website CI": ["x.pr"] }));
	});
});

describe("queueBaseSha", () => {
	it("reads the base sha from a merge-queue branch", () => {
		assert.equal(queueBaseSha(queueRun.head_branch), before);
	});

	it("ignores other branches", () => {
		assert.equal(queueBaseSha("master"), undefined);
		assert.equal(queueBaseSha(null), undefined);
	});
});

describe("ci.yml BASELINE_PRODUCERS", () => {
	it("names jobs that exist in ci.yml", () => {
		const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
		const block = ci.slice(ci.indexOf("BASELINE_PRODUCERS:"), ci.indexOf("run: node devops/github/ci/find-validated"));
		const names = [...block.matchAll(/"([^"$]+)":/g)].map((m) => m[1]);
		assert.deepEqual(names.sort(), Object.keys(producers).sort());
		for (const name of names) assert.match(ci, new RegExp(`^    name: ${name}$`, "m"));
	});
});
