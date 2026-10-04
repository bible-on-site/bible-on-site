import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Required check that gates every module test job of the workflow. */
export const GATE_JOB_NAME = "Cross Module CI";

export interface WorkflowRun {
	id: number;
	event: string;
	head_sha: string;
	head_branch: string | null;
	status: string;
	conclusion: string | null;
}
export interface Job {
	name: string;
	conclusion: string | null;
}
export interface Artifact {
	name: string;
	expired: boolean;
}
export interface BaselineCopy {
	source: string;
	target: string;
}
export type GitHubGet = (apiPath: string) => Promise<Record<string, unknown>>;

/** The commit a merge-queue group was built on, encoded in its temporary branch name. */
export function queueBaseSha(headBranch: string | null): string | undefined {
	return headBranch?.match(/^gh-readonly-queue\/.+\/pr-\d+-([0-9a-f]{40})$/)?.[1];
}

/**
 * A queue run validated a master push only if it tested the pushed commit on top of the
 * previous master head; otherwise the push is not the fast-forward the queue produced.
 */
export function isValidatedRun(run: WorkflowRun, sha: string, before: string): boolean {
	return (
		run.event === "merge_group" &&
		run.head_sha === sha &&
		run.status === "completed" &&
		run.conclusion === "success" &&
		queueBaseSha(run.head_branch) === before
	);
}

/** Baseline (`*.master`) artifacts each queue-run job publishes when it runs, by job name. */
export type BaselineProducers = Record<string, string[]>;
export type Reuse = { runId: number; copies: BaselineCopy[] } | { reason: string };

/**
 * Every job that ran in the queue run must have left its fresh outputs, `<prefix>.<runId>`
 * (or unsuffixed `<prefix>`) for each `<prefix>.master` it produces. Baselines of jobs that
 * did not run carry forward as restored by determine_baseline_availability.
 */
export function requiredBaselineCopies(
	runId: number,
	jobs: Job[],
	artifacts: Artifact[],
	producers: BaselineProducers,
): BaselineCopy[] | { missing: string } {
	const available = new Set(artifacts.filter((a) => !a.expired).map((a) => a.name));
	const copies: BaselineCopy[] = [];
	for (const job of jobs.filter((j) => j.conclusion === "success")) {
		for (const target of producers[job.name] ?? []) {
			if (!target.endsWith(".master")) throw new Error(`${target} is not a .master baseline`);
			const prefix = target.slice(0, -".master".length);
			const source = [`${prefix}.${runId}`, prefix].find((name) => available.has(name));
			if (!source) return { missing: `${job.name} output for ${target}` };
			copies.push({ source, target });
		}
	}
	return copies;
}

async function getAll<T>(get: GitHubGet, apiPath: string, key: string): Promise<T[]> {
	const items: T[] = [];
	for (let page = 1; ; page++) {
		const batch = (await get(`${apiPath}&per_page=100&page=${page}`))[key] as T[];
		items.push(...batch);
		if (batch.length < 100) return items;
	}
}

export async function findReusableMergeGroupRun(options: {
	eventName: string | undefined;
	sha: string;
	before: string | undefined;
	workflowFile: string;
	producers: BaselineProducers;
	get: GitHubGet;
}): Promise<Reuse> {
	const { eventName, sha, before, workflowFile, producers, get } = options;
	if (eventName !== "push" || !before) return { reason: `${eventName} event` };
	const runs = await getAll<WorkflowRun>(
		get,
		`actions/workflows/${workflowFile}/runs?event=merge_group&head_sha=${sha}`,
		"workflow_runs",
	);
	const validated: { run: WorkflowRun; jobs: Job[] }[] = [];
	for (const run of runs.filter((r) => isValidatedRun(r, sha, before))) {
		const jobs = await getAll<Job>(get, `actions/runs/${run.id}/jobs?filter=latest`, "jobs");
		if (jobs.some((job) => job.name === GATE_JOB_NAME && job.conclusion === "success")) {
			validated.push({ run, jobs });
		}
	}
	if (validated.length !== 1) {
		return { reason: `${validated.length} successful merge-queue runs match ${sha} on ${before}` };
	}
	const [{ run, jobs }] = validated;
	const artifacts = await getAll<Artifact>(get, `actions/runs/${run.id}/artifacts?`, "artifacts");
	const copies = requiredBaselineCopies(run.id, jobs, artifacts, producers);
	if ("missing" in copies) {
		return { reason: `merge-queue run ${run.id} has no unexpired ${copies.missing}` };
	}
	return { runId: run.id, copies };
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set`);
	return value;
}

async function main(): Promise<void> {
	const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
	const repository = requireEnv("GITHUB_REPOSITORY");
	const token = requireEnv("GH_TOKEN");
	const get: GitHubGet = async (apiPath) => {
		const response = await fetch(`${apiUrl}/repos/${repository}/${apiPath}`, {
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});
		if (!response.ok) throw new Error(`GET ${apiPath}: ${response.status} ${await response.text()}`);
		return (await response.json()) as Record<string, unknown>;
	};
	const event = JSON.parse(readFileSync(requireEnv("GITHUB_EVENT_PATH"), "utf8")) as {
		before?: string;
	};
	const reuse = await findReusableMergeGroupRun({
		eventName: process.env.GITHUB_EVENT_NAME,
		sha: requireEnv("GITHUB_SHA"),
		before: event.before,
		workflowFile: path.basename(requireEnv("GITHUB_WORKFLOW_REF").split("@")[0]),
		producers: JSON.parse(requireEnv("BASELINE_PRODUCERS")) as BaselineProducers,
		get,
	});
	const [runId, copies] = "runId" in reuse ? [reuse.runId, reuse.copies] : ["", []];
	console.log(
		"runId" in reuse
			? `Merge-queue run ${runId} already validated ${process.env.GITHUB_SHA}; baselines to copy: ${JSON.stringify(copies)}`
			: `Running module tests: ${reuse.reason}.`,
	);
	const output = process.env.GITHUB_OUTPUT;
	if (output) appendFileSync(output, `run_id=${runId}\nbaseline_copies=${JSON.stringify(copies)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
