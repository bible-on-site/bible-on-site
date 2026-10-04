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

/** Maps each `<prefix>.master` baseline to the queue run's `<prefix>.<runId>` (or unsuffixed `<prefix>`) artifact. */
export function baselineCopies(
	runId: number,
	artifacts: Artifact[],
	masterNames: string[],
): BaselineCopy[] {
	const available = new Set(artifacts.filter((a) => !a.expired).map((a) => a.name));
	return masterNames.flatMap((target) => {
		if (!target.endsWith(".master")) throw new Error(`${target} is not a .master baseline`);
		const prefix = target.slice(0, -".master".length);
		const source = [`${prefix}.${runId}`, prefix].find((name) => available.has(name));
		return source ? [{ source, target }] : [];
	});
}

async function getAll<T>(get: GitHubGet, apiPath: string, key: string): Promise<T[]> {
	const items: T[] = [];
	for (let page = 1; ; page++) {
		const batch = (await get(`${apiPath}&per_page=100&page=${page}`))[key] as T[];
		items.push(...batch);
		if (batch.length < 100) return items;
	}
}

export async function findValidatedMergeGroupRun(options: {
	eventName: string | undefined;
	sha: string;
	before: string | undefined;
	workflowFile: string;
	get: GitHubGet;
}): Promise<number | undefined> {
	const { eventName, sha, before, workflowFile, get } = options;
	if (eventName !== "push" || !before) return undefined;
	const runs = await getAll<WorkflowRun>(
		get,
		`actions/workflows/${workflowFile}/runs?event=merge_group&head_sha=${sha}`,
		"workflow_runs",
	);
	for (const run of runs.filter((r) => isValidatedRun(r, sha, before))) {
		const jobs = await getAll<Job>(get, `actions/runs/${run.id}/jobs?filter=latest`, "jobs");
		if (jobs.some((job) => job.name === GATE_JOB_NAME && job.conclusion === "success")) {
			return run.id;
		}
	}
	return undefined;
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
	const runId = await findValidatedMergeGroupRun({
		eventName: process.env.GITHUB_EVENT_NAME,
		sha: requireEnv("GITHUB_SHA"),
		before: event.before,
		workflowFile: path.basename(requireEnv("GITHUB_WORKFLOW_REF").split("@")[0]),
		get,
	});
	const copies = runId
		? baselineCopies(
				runId,
				await getAll<Artifact>(get, `actions/runs/${runId}/artifacts?`, "artifacts"),
				requireEnv("BASELINE_ARTIFACT_NAMES").split(/\s+/).filter(Boolean),
			)
		: [];
	console.log(
		runId
			? `Merge-queue run ${runId} already validated ${process.env.GITHUB_SHA}; baselines to copy: ${JSON.stringify(copies)}`
			: "No successful merge-queue run validated this commit; running module tests.",
	);
	const output = process.env.GITHUB_OUTPUT;
	if (output) {
		appendFileSync(output, `run_id=${runId ?? ""}\nbaseline_copies=${JSON.stringify(copies)}\n`);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
