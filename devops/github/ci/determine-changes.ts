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
	/**
	 * Files inside `directory` that need the module's checks but are not part
	 * of the released package, so they must not package, release, or bump.
	 */
	ciOnlyPattern?: RegExp;
}

const SHARED_CI_PATHS = [
	".github/workflows/ci.yml",
	"devops/github/ci/determine-changes.ts",
];
const RELEASE_CI_PATHS = [
	...SHARED_CI_PATHS,
	".github/workflows/shared-release.yml",
];
// Shared build context of every web/ release Docker image (#2292).
const DOCKER_BUILD_CI_PATHS = ["web/.dockerignore"];
// Deterministic E2E test-selection tooling plus the shared Playwright
// evidence reporter — consumed by the website, admin and API E2E jobs
// (the Appium suite already lists the selector under `app`, #2085).
const E2E_IMPACT_CI_PATHS = [
	"devops/github/ci/e2e-impact",
	"web/shared",
];

export const MODULES = {
	website: {
		directory: "web/bible-on-site",
		// Approved timing changes must package/release the website too.
		extraModulePaths: [
			"data/recitation/recitation.sqlite",
			"app/BibleOnSite/Resources/Raw/recitation-audio.html",
		],
		ciPaths: [
			...RELEASE_CI_PATHS,
			...E2E_IMPACT_CI_PATHS,
			"devops/github/ci/bencher-comparison.mjs",
			// cd-aws.yml owns the post-deploy verifier invocation contract
			// (NODE_PATH → devops deps) that the deploy_verifier guard replays.
			".github/workflows/cd-aws.yml",
			// The deploy_verifier job also guards canonical nginx redirects.
			"docs/aws/cloudformation/ec2-nginx/router/router.conf",
		],
		// Test-only changes run website checks but cannot alter the deployed
		// site, so they must not package, release, or bump the version (#2132):
		// the tests/ tree, colocated *.test.*/​*.spec.* files (including
		// .test.env), the root jest*/playwright* harness and the e2e-only
		// helpers it imports, and coverage fixtures. package*.json,
		// next.config.mjs, src/, public/, scripts/ (build-time), and
		// Docker/tsconfig build inputs stay release-affecting.
		ciOnlyPattern:
			/^web\/bible-on-site\/(tests\/|.*\.(test|spec)\.[^/]+$|jest[^/]*\.[^/]*$|playwright[^/]*\.[^/]*$|\.covignore\.mjs$|shared\/typing\/coverage\.d\.ts$|get-debug-port\.js$|launch-e2e-server\.mts$)/,
	},
	api: {
		directory: "web/api",
		ciPaths: [
			...RELEASE_CI_PATHS,
			...E2E_IMPACT_CI_PATHS,
			...DOCKER_BUILD_CI_PATHS,
			".github/workflows/shared-dockerize.yml",
		],
	},
	app: {
		directory: "app",
		// Both approved timings and the Opus inventory ship in the native app.
		extraModulePaths: [
			"data/recitation/recitation.sqlite",
			"web/bible-on-site/src/data/recitation/opus-playback.json",
		],
		// The e2e-impact selector/collector and the exec coverage-tree
		// extractor drive the Appium suite (#2085). The runner workflow defines
		// the device legs themselves — install logic, emulator settings and the
		// Release startup smoke (#2373) — so a runner-only edit must trigger
		// the same app checks as a parent-workflow edit.
		ciPaths: [
			...RELEASE_CI_PATHS,
			".github/workflows/app-package.yml",
			".github/workflows/app-mobile-e2e.yml",
			".github/workflows/app-mobile-e2e-runner.yml",
			"devops/github/ci/e2e-impact",
			"devops/e2e-coverage-trees",
		],
		// The native decoder inputs are app-owned (#2391): the generator and its
		// manifest live under app/devops/recitation-decoder, inside this module,
		// and the generated asset ships under app/BibleOnSite. Website manifests
		// and the browser player no longer select native checks; decoder-version
		// parity with web/bible-on-site/package.json is enforced by
		// check-decoder-pins.mjs in the decoder verification suites.
		// Approved timings are packaged inputs through extraModulePaths.
		// Test projects exercise the app but never change its package, so a
		// test-only change must not ship a store release or bump the version.
		ciOnlyPattern: /^app\/(BibleOnSite\.Tests[^/]*|mobile-e2e)\//,
	},
	admin: {
		directory: "web/admin",
		ciPaths: [
			...SHARED_CI_PATHS,
			...E2E_IMPACT_CI_PATHS,
			...DOCKER_BUILD_CI_PATHS,
			"devops/rustfs",
			"devops/docker-compose.yml",
			"devops/package.json",
			"devops/package-lock.json",
		],
	},
	bulletin: {
		directory: "web/bulletin",
		// The release image also compiles the API's shared entities crate.
		ciPaths: [
			...RELEASE_CI_PATHS,
			...DOCKER_BUILD_CI_PATHS,
			"web/api/entities",
		],
	},
	data: {
		directory: "data",
		// Data-deploy tooling changes (e.g. its SQL_FILES manifest) must re-run
		// the data CD and re-populate the production database.
		ciPaths: [...SHARED_CI_PATHS, "devops/deploy/data-deploy"],
	},
	perushim_pipeline: {
		directory: "data/sefaria/pipelines/perushim-view",
		// The delivered FTS index also includes the app's bundled scripture.
		extraModulePaths: [
			"app/BibleOnSite/Resources/Raw/sefaria-dump-5784-sivan-4.tanah_view.sqlite",
		],
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
						(isAt(file, rule.directory) &&
							!(rule.ciOnlyPattern?.test(file) ?? false)) ||
						(rule.extraModulePaths ?? []).includes(file),
				),
				ci_changed: changedFiles.some(
					(file) =>
						rule.ciPaths.some((path) => isAt(file, path)) ||
						(rule.extraCiPattern?.test(file) ?? false) ||
						(rule.ciOnlyPattern?.test(file) ?? false),
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
