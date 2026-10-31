/**
 * Determines, in one job, which CI modules changed between the event's base
 * revision and HEAD. Writes `<module>_module_changed` and `<module>_ci_changed`
 * to GITHUB_OUTPUT for every module in MODULES, plus the manual schema-only
 * data deployment routing decision.
 *
 * Works on a shallow checkout. PRs compare the tested merge commit with its
 * first parent; the event payload's base can lag behind that tested base.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import {
	isPublishDocstringOnlyChange,
	PUBLISH_SOURCE_PATH,
} from "./publish-docstring.mts";
import { parseRecoveryRequest } from "../release/recovery-request.mjs";

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
	// Composite actions (setup-js, lcov-image) are consumed by jobs across
	// every module — an action-only change must select their consumers.
	".github/actions",
	"devops/github/ci/determine-changes.ts",
];
const RELEASE_CI_PATHS = [
	...SHARED_CI_PATHS,
	".github/workflows/shared-release.yml",
];
// Shared build context of every web/ release Docker image (#2292).
const DOCKER_BUILD_CI_PATHS = ["web/.dockerignore"];
// Native validation uses the same service Dockerfiles without publishing.
const NATIVE_IMAGE_CI_PATHS = [
	".github/workflows/architecture-validation.yml",
	"devops/github/ci/verify-native-image.mjs",
	"devops/github/ci/verify-native-image.test.mjs",
	"devops/github/ci/native-api-fixture.mjs",
	"devops/github/ci/native-api-fixture.test.mjs",
	"devops/github/ci/native-api-fixture.sql",
	"devops/github/ci/native-api-fixture-rows.sql",
	"devops/github/ci/verify-api-native.mjs",
	"devops/github/ci/verify-api-native.test.mjs",
	"devops/github/ci/verify-website-native.mjs",
];
// Deterministic E2E test-selection tooling plus the shared Playwright
// evidence reporter — consumed by the website, admin and API E2E jobs
// (the Appium suite already lists the selector under `app`, #2085).
const E2E_IMPACT_CI_PATHS = ["devops/github/ci/e2e-impact", "web/shared"];

// This evaluation guide is documentation, not an annotation or SQL input.
// Keep the exception exact: other Markdown paths may be pipeline inputs.
const DATA_DOCUMENTATION_PATTERN = /^data\/annotations\/GOLDEN\.md$/;

export const MODULES = {
	website: {
		directory: "web/bible-on-site",
		// Approved timing changes must package/release the website too.
		extraModulePaths: [
			"data/recitation/recitation.sqlite",
			"app/BibleOnSite/Resources/Raw/recitation-audio.html",
		],
		ciPaths: [
			...NATIVE_IMAGE_CI_PATHS,
			...DOCKER_BUILD_CI_PATHS,
			...RELEASE_CI_PATHS,
			...E2E_IMPACT_CI_PATHS,
			"devops/github/ci/bencher-comparison.mjs",
			// cd-aws.yml owns the post-deploy verifier invocation contract
			// (NODE_PATH → devops deps) that the deploy_verifier guard replays.
			".github/workflows/cd-aws.yml",
			// The calendar-PDF artifact publisher defines the generation/publish
			// contract verified by the calendar_pdf_artifacts job (#2608).
			".github/workflows/calendar-pdf-publish.yml",
			// The deploy_verifier job also guards canonical nginx redirects.
			"docs/aws/cloudformation/ec2-nginx/router/router.conf",
		],
		// Test-only changes run website checks but cannot alter the deployed
		// site, so they must not package, release, or bump the version (#2132):
		// the tests/ tree, colocated *.test.*/​*.spec.* files (including
		// .test.env), the root jest*/playwright* harness and the e2e-only
		// helpers it imports, coverage fixtures and the coverage-report CLI.
		// package*.json, next.config.mjs, src/, public/, other build-time
		// scripts/, and Docker/tsconfig inputs stay release-affecting.
		ciOnlyPattern:
			/^web\/bible-on-site\/(tests\/|.*\.(test|spec)\.[^/]+$|jest[^/]*\.[^/]*$|playwright[^/]*\.[^/]*$|\.covignore\.mjs$|shared\/typing\/coverage\.d\.ts$|launch-e2e-server\.mts$|scripts\/coverage-gaps\.mjs$)/,
	},
	api: {
		directory: "web/api",
		ciPaths: [
			...NATIVE_IMAGE_CI_PATHS,
			"devops/github/ci/pending-api-release.mjs",
			"devops/github/ci/pending-api-release.test.mjs",
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
			// The cross-module job merges the app's coverage layers with it.
			"devops/merge-lcov.mts",
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
			"devops/github/release/recovery-request.mjs",
			"devops/github/release/recovery-request.test.mjs",
			...NATIVE_IMAGE_CI_PATHS,
			...SHARED_CI_PATHS,
			...E2E_IMPACT_CI_PATHS,
			...DOCKER_BUILD_CI_PATHS,
			"devops/rustfs",
			"devops/docker-compose.yml",
			"devops/package.json",
			"devops/bun.lock",
			// admin's coverage:merge calls it to build the published report.
			"devops/merge-lcov.mts",
		],
	},
	bulletin: {
		directory: "web/bulletin",
		// The release image also compiles the API's shared entities crate.
		ciPaths: [
			"devops/github/release/recovery-request.mjs",
			"devops/github/release/recovery-request.test.mjs",
			...RELEASE_CI_PATHS,
			...DOCKER_BUILD_CI_PATHS,
			"web/api/entities",
		],
	},
	data: {
		directory: "data",
		ciOnlyPattern: DATA_DOCUMENTATION_PATTERN,
		// Data-deploy tooling changes require checks and normally re-run data CD.
		// ECR recovery/version tests run in recitation_ci, without data delivery.
		// Schema-only changes use a separate manual-deployment routing gate.
		ciPaths: [
			...SHARED_CI_PATHS,
			"devops/deploy/data-deploy",
			"docs/aws/cloudformation/daily-bulletin-ses.yaml",
			"docs/aws/cloudformation/daily-bulletin-telegram.yaml",
			"docs/aws/cloudformation/daily-bulletin-whatsapp.yaml",
			"devops/daily-bulletin-infra.test.mjs",
			"web/bulletin/assets/email",
			"web/bulletin/scripts/prepare-email-assets.mjs",
			"app/BibleOnSite/Resources/Images/logo_header.jpg",
			"web/bible-on-site/public/icons/envelope.svg",
			"web/bible-on-site/public/icons/phone.svg",
			"web/bible-on-site/public/icons/whatsapp.svg",
			"web/bible-on-site/public/icons/telegram.svg",
			"devops/deploy/ecr-deploy",
			"devops/github/ci/release-coverage.mjs",
			"devops/github/release/api-image-assets.mjs",
			"devops/github/release/api-image-assets.test.mjs",
			"devops/github/release/check-deployment.mjs",
			"devops/github/release/check-deployment.test.mjs",
			"devops/github/release/release-provenance.mjs",
			"devops/package.json",
			"devops/bun.lock",
			"devops/github/ci/determine-changes.test.ts",
			"devops/github/ci/publish-docstring.mts",
			"devops/github/ci/publish-docstring-proof.py",
		],
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

// The data delivery path whose change legitimately re-runs a data deployment
// with unchanged payload content. `data_ci_changed` additionally covers shared
// CI plumbing (ci.yml, composite actions, this detector), which must never
// enter Release Data: the perushim producer correctly skips those runs, so no
// current-run SQL artifact exists to bind (#2730).
const DATA_DEPLOY_PATHS = ["devops/deploy/data-deploy"];

/** Release intent for data delivery tooling, separate from generic CI checks. */
export function isDataDeployChange(changedFiles: string[]): boolean {
	return changedFiles.some((file) =>
		DATA_DEPLOY_PATHS.some((path) => isAt(file, path)),
	);
}

/**
 * Route schema-only data changes to the explicitly approved manual migration path.
 * This path check does not certify SQL safety or existence: deleted migrations
 * also stay manual rather than triggering a full production bootstrap.
 */
export function isSchemaOnlyDataChange(files: string[]): boolean {
	const changedFiles = files.filter(
		(file) => !DATA_DOCUMENTATION_PATTERN.test(file),
	);
	const dataFiles = changedFiles.filter((file) => isAt(file, "data"));
	// Calendar exports are repaired through a guarded date-only database operation.
	// Converter/fixture changes must not launch a replacement production bootstrap.
	const calendarConverter =
		"data/sefaria/pipelines/tanah-view/src/commands/mysql.rs";
	if (
		dataFiles.includes(calendarConverter) &&
		!changedFiles.some((file) =>
			MODULES.perushim_pipeline.extraModulePaths.includes(file),
		) &&
		dataFiles.every(
			(file) =>
				file === calendarConverter ||
				file === "data/mysql/tanah_sefarim_and_perakim_data.sql",
		)
	)
		return true;
	const bulletinMigrations = new Set([
		"data/mysql/tanah_daily_bulletin_upgrade.sql",
		"data/mysql/tanah_daily_bulletin_telegram_upgrade.sql",
		"data/mysql/tanah_daily_bulletin_whatsapp_upgrade.sql",
	]);
	const hasBulletinMigration = dataFiles.some((file) =>
		bulletinMigrations.has(file),
	);
	return (
		dataFiles.length > 0 &&
		!changedFiles.some((file) =>
			MODULES.perushim_pipeline.extraModulePaths.includes(file),
		) &&
		dataFiles.every(
			(file) =>
				/^data\/mysql\/tanahpedia_alter_[^/]+\.sql$/.test(file) ||
				bulletinMigrations.has(file) ||
				// The bootstrap's migration-preservation tests accompany this
				// additive upgrade; they must not trigger a production data rebuild.
				(hasBulletinMigration &&
					file === "data/mysql/db-populator/src/main.rs"),
		)
	);
}

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

/** Recovery selects ordinary checks/packages for only the explicitly named services. */
export function applyReleaseRecovery(
	changes: ModuleChanges,
	modules: readonly string[],
): ModuleChanges {
	if (
		new Set(modules).size !== modules.length ||
		modules.some((module) => module !== "admin" && module !== "bulletin")
	)
		throw new Error("Release recovery is limited to admin and bulletin");
	return Object.fromEntries(
		Object.entries(changes).map(([key, flags]) => [
			key,
			modules.includes(key)
				? { module_changed: true, ci_changed: true }
				: { ...flags },
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
			// Keep the immediate queue delta for diagnostics only. HEADGREEN can
			// merge entries ahead using this group's checks, so main validates
			// every module in the combined head rather than trusting this delta.
			return {
				kind: "sha",
				sha: required(event.merge_group?.base_sha, "merge_group.base_sha"),
			};
		default:
			return { kind: "branch", branch: "master" };
	}
}

interface ChangeContext {
	baseSha: string;
	headSha: string;
	files: string[];
}

function changedFilesContext(base: BaseRevision, cwd?: string): ChangeContext {
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	const headSha = git("rev-parse", "HEAD");
	const shallow = git("rev-parse", "--is-shallow-repository") === "true";
	// CI's shallow clone still needs bounded ancestry. Never make an existing
	// full repository shallow merely to resolve an event base.
	const fetch = (depth: number, ref: string) =>
		git(
			"fetch",
			"--no-tags",
			...(shallow ? ["--depth=" + depth] : []),
			"origin",
			ref,
		);
	let baseSha: string;
	if (base.kind === "sha") {
		fetch(1, base.sha);
		baseSha = base.sha;
	} else if (base.kind === "parent" || base.kind === "merge-parent") {
		fetch(2, headSha);
		if (base.kind === "merge-parent") {
			// Fail rather than accidentally counting master changes if checkout
			// stops using the synthetic PR merge commit.
			git("rev-parse", "--verify", headSha + "^2");
		}
		baseSha = git("rev-parse", headSha + "^");
	} else {
		fetch(1, base.branch);
		baseSha = git("rev-parse", "FETCH_HEAD");
	}
	baseSha = git("rev-parse", "--verify", baseSha + "^{commit}");
	console.log("BASE_SHA: " + baseSha);
	console.log("HEAD_SHA: " + headSha);
	const diff = git("diff", "--name-only", baseSha, headSha);
	return { baseSha, headSha, files: diff ? diff.split("\n") : [] };
}

export function listChangedFiles(base: BaseRevision, cwd?: string): string[] {
	return changedFilesContext(base, cwd).files;
}

export function main(env = process.env, cwd?: string): ModuleChanges {
	const { GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_OUTPUT } = env;
	if (!GITHUB_EVENT_NAME || !GITHUB_EVENT_PATH || !GITHUB_OUTPUT) {
		throw new Error(
			"GITHUB_EVENT_NAME, GITHUB_EVENT_PATH and GITHUB_OUTPUT are required",
		);
	}
	const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, "utf8"));
	const recoveryModules = parseRecoveryRequest({
		eventName: GITHUB_EVENT_NAME,
		ref: env.GITHUB_REF,
		sha: env.GITHUB_SHA,
		requested: event.inputs?.release_recovery ?? "none",
	});
	const context = changedFilesContext(
		baseRevision(GITHUB_EVENT_NAME, event),
		cwd,
	);
	const { files } = context;
	console.log(`Changed files:\n${files.join("\n")}`);
	const docOnly =
		files.includes(PUBLISH_SOURCE_PATH) &&
		isPublishDocstringOnlyChange({ ...context, cwd });
	const deliveryFiles = docOnly
		? files.filter((file) => file !== PUBLISH_SOURCE_PATH)
		: files;
	const changes = applyReleaseRecovery(
		detectChanges(deliveryFiles),
		recoveryModules,
	);
	if (docOnly) {
		changes.data.ci_changed = true;
		console.log(
			"Audited publisher docstring-only change: data checks required, no delivery.",
		);
	}
	const mergeGroup = GITHUB_EVENT_NAME === "merge_group";
	if (mergeGroup) {
		// A preceding queue entry may still have unfinished checks. Validate
		// the combined head conservatively, without any release intent.
		for (const flags of Object.values(changes)) {
			flags.module_changed = false;
			flags.ci_changed = true;
		}
	}
	const lines = Object.entries(changes).flatMap(([key, flags]) => [
		`${key}_module_changed=${flags.module_changed}`,
		`${key}_ci_changed=${flags.ci_changed}`,
	]);
	lines.push(
		`data_schema_only_changed=${!mergeGroup && isSchemaOnlyDataChange(deliveryFiles)}`,
	);
	lines.push(`data_deploy_changed=${!mergeGroup && isDataDeployChange(files)}`);
	lines.push(`admin_release_recovery=${recoveryModules.includes("admin")}`);
	lines.push(
		`bulletin_release_recovery=${recoveryModules.includes("bulletin")}`,
	);
	console.log(lines.join("\n"));
	appendFileSync(GITHUB_OUTPUT, `${lines.join("\n")}\n`);
	return changes;
}

if (import.meta.main) {
	main();
}
