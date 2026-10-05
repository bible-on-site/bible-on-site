/**
 * Determines, in one job, which CI modules changed between the event's base
 * revision and HEAD. Writes `<module>_module_changed` and `<module>_ci_changed`
 * to GITHUB_OUTPUT for every module in MODULES.
 *
 * Works on a shallow checkout. PRs compare the tested merge commit with its
 * first parent; the event payload's base can lag behind that tested base.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

interface ModuleRule {
	directory: string;
	/** Files outside `directory` whose change also changes the module. */
	extraModulePaths?: string[];
	/** Files or directories whose change requires the module's checks. */
	ciPaths: string[];
	/** Files that require the module's checks without changing the module. */
	extraCiPattern?: RegExp;
}

const SHARED_CI_PATHS = [
	".github/workflows/ci.yml",
	"devops/github/ci/determine-changes.ts",
];
const RELEASE_CI_PATHS = [
	...SHARED_CI_PATHS,
	".github/workflows/shared-release.yml",
];

export const MODULES = {
	website: {
		directory: "web/bible-on-site",
		// Approved timing changes must package/release the website too.
		extraModulePaths: [
			"data/recitation/recitation.sqlite",
			"app/BibleOnSite/Resources/Raw/recitation-audio.html",
		],
		ciPaths: RELEASE_CI_PATHS,
	},
	api: { directory: "web/api", ciPaths: RELEASE_CI_PATHS },
	app: {
		directory: "app",
		ciPaths: [...RELEASE_CI_PATHS, ".github/workflows/app-mobile-e2e.yml"],
		// Shared decoder changes need native checks. Only changes to the packaged
		// app itself need an app version, package and release. Website timing
		// batches also change their package version files.
		extraCiPattern:
			/^web\/bible-on-site\/(package(-lock)?\.json|src\/lib\/recitation-audio\.ts)$/,
	},
	admin: {
		directory: "web/admin",
		ciPaths: [
			...SHARED_CI_PATHS,
			"devops/rustfs",
			"devops/docker-compose.yml",
			"devops/package.json",
			"devops/package-lock.json",
		],
	},
	bulletin: { directory: "web/bulletin", ciPaths: RELEASE_CI_PATHS },
	data: {
		directory: "data",
		// Data-deploy tooling changes (e.g. its SQL_FILES manifest) must re-run
		// the data CD and re-populate the production database.
		ciPaths: [...SHARED_CI_PATHS, "devops/deploy/data-deploy"],
	},
	perushim_pipeline: {
		directory: "data/sefaria/pipelines/perushim-view",
		ciPaths: SHARED_CI_PATHS,
	},
} satisfies Record<string, ModuleRule>;

export type ModuleKey = keyof typeof MODULES;
export type ModuleChanges = Record<
	ModuleKey,
	{ module_changed: boolean; ci_changed: boolean }
>;

const isAt = (file: string, path: string) =>
	file === path || file.startsWith(`${path}/`);

export function detectChanges(changedFiles: string[]): ModuleChanges {
	const rules: Record<ModuleKey, ModuleRule> = MODULES;
	return Object.fromEntries(
		Object.entries(rules).map(([key, rule]) => [
			key,
			{
				module_changed: changedFiles.some(
					(file) =>
						isAt(file, rule.directory) ||
						(rule.extraModulePaths ?? []).includes(file),
				),
				ci_changed: changedFiles.some(
					(file) =>
						rule.ciPaths.some((path) => isAt(file, path)) ||
						(rule.extraCiPattern?.test(file) ?? false),
				),
			},
		]),
	) as ModuleChanges;
}

export type BaseRevision =
	| { kind: "sha"; sha: string }
	| { kind: "parent" }
	| { kind: "merge-parent" }
	| { kind: "branch"; branch: string };

interface EventPayload {
	pull_request?: { base: { sha: string } };
	before?: string;
	merge_group?: { base_sha: string };
}

export function baseRevision(
	eventName: string,
	event: EventPayload,
): BaseRevision {
	const required = (sha: string | undefined, field: string) => {
		if (!sha) throw new Error(`${eventName} event has no ${field}`);
		return sha;
	};
	switch (eventName) {
		case "pull_request":
			// actions/checkout uses github.sha, the tested PR merge commit. Its
			// first parent includes any newer master-only release version bumps.
			return { kind: "merge-parent" };
		case "push": {
			const before = required(event.before, "before");
			// An all-zero `before` means the ref was created; compare with HEAD's parent.
			return /^0+$/.test(before)
				? { kind: "parent" }
				: { kind: "sha", sha: before };
		}
		case "merge_group":
			// Exclude changes of PRs queued ahead; master lacks them.
			return {
				kind: "sha",
				sha: required(event.merge_group?.base_sha, "merge_group.base_sha"),
			};
		default:
			return { kind: "branch", branch: "master" };
	}
}

export function listChangedFiles(base: BaseRevision, cwd?: string): string[] {
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	let baseSha: string;
	if (base.kind === "sha") {
		git("fetch", "--no-tags", "--depth=1", "origin", base.sha);
		baseSha = base.sha;
	} else if (base.kind === "parent" || base.kind === "merge-parent") {
		git("fetch", "--no-tags", "--depth=2", "origin", git("rev-parse", "HEAD"));
		if (base.kind === "merge-parent") {
			// Fail rather than accidentally counting master changes if checkout
			// stops using the synthetic PR merge commit.
			git("rev-parse", "--verify", "HEAD^2");
		}
		baseSha = git("rev-parse", "HEAD^");
	} else {
		git("fetch", "--no-tags", "--depth=1", "origin", base.branch);
		baseSha = git("rev-parse", "FETCH_HEAD");
	}
	console.log(`BASE_SHA: ${baseSha}`);
	const diff = git("diff", "--name-only", baseSha, "HEAD");
	return diff ? diff.split("\n") : [];
}

export function main(env = process.env, cwd?: string): ModuleChanges {
	const { GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_OUTPUT } = env;
	if (!GITHUB_EVENT_NAME || !GITHUB_EVENT_PATH || !GITHUB_OUTPUT) {
		throw new Error(
			"GITHUB_EVENT_NAME, GITHUB_EVENT_PATH and GITHUB_OUTPUT are required",
		);
	}
	const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, "utf8"));
	const files = listChangedFiles(baseRevision(GITHUB_EVENT_NAME, event), cwd);
	console.log(`Changed files:\n${files.join("\n")}`);
	const changes = detectChanges(files);
	const lines = Object.entries(changes).flatMap(([key, flags]) => [
		`${key}_module_changed=${flags.module_changed}`,
		`${key}_ci_changed=${flags.ci_changed}`,
	]);
	console.log(lines.join("\n"));
	appendFileSync(GITHUB_OUTPUT, `${lines.join("\n")}\n`);
	return changes;
}

if (import.meta.main) {
	main();
}
