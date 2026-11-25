/**
 * Determines, in one job, which CI modules changed between the event's base
 * revision and HEAD. Writes `<module>_module_changed` and `<module>_ci_changed`
 * to GITHUB_OUTPUT for every module in MODULES, plus the data deployment
 * and validation routing decisions and `docs_only` — true only when every
 * touched path is inert documentation and no module's checks fired,
 * letting required checks resolve without heavy validation.
 *
 * Works on a shallow checkout. PRs compare the tested merge commit with its
 * first parent; the event payload's base can lag behind that tested base.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { parseRecoveryRequest } from "../release/recovery-request.mjs";
import {
	PUBLISH_SOURCE_PATH,
	isPublishDocstringOnlyChange,
} from "./publish-docstring.mts";

interface ModuleRule {
	directory: string;
	/**
	 * Files — or directory prefixes — outside `directory` whose change also
	 * changes the module. Entries match like `directory` (exact path or
	 * path prefix); every existing entry is a single file, so prefix
	 * semantics only take effect for the shared contract trees below.
	 */
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
	"devops/github/ci/native-admin-fixture.mjs",
	"devops/github/ci/native-admin-fixture.test.mjs",
	"devops/github/ci/native-admin-fixture.sql",
	"devops/github/ci/verify-api-native.mjs",
	"devops/github/ci/verify-api-native.test.mjs",
	"devops/github/ci/verify-website-native.mjs",
];
// Deterministic E2E test-selection tooling plus the shared Playwright
// evidence reporter — consumed by the website, admin and API E2E jobs
// (the Appium suite already lists the selector under `app`, #2085).
const E2E_IMPACT_CI_PATHS = ["devops/github/ci/e2e-impact", "web/shared"];

/**
 * Runtime contract sources under `web/shared/` compiled into each release
 * app (#3710). A change to them must package and release the importers —
 * CI-only coverage is not enough, or a fix that touches only a shared
 * contract would deploy nothing. Test-only fixtures
 * (`revalidate/examples.ts`, `tests-util/`) are deliberately absent so
 * fixture edits stay CI-only.
 */
const WEBSITE_ADMIN_SHARED_CONTRACTS = [
	"web/shared/bulletin-join/index.ts",
	"web/shared/revalidate/index.ts",
	"web/shared/tanahpedia/index.ts",
	"web/shared/reading-metrics",
];
// The article-relationship DTOs bind the admin UI and the Rust API.
const ADMIN_API_SHARED_CONTRACTS = ["web/shared/article-relationships"];

const UBUNTU_MIRROR_CI_PATHS = [
	"devops/github/ci/ubuntu-apt-mirrors.mjs",
	"devops/github/ci/ubuntu-apt-mirrors.test.mjs",
];

// The evaluation guide and MongoDB test image are not delivered data inputs.
// Keep exact boundaries so actual annotations, SQL and pipelines still deliver.
const DATA_CI_ONLY_PATTERN =
	/^data\/(?:annotations\/GOLDEN\.md$|sefaria\/mongodb-docker\/)/;

export const MODULES = {
	website: {
		directory: "web/bible-on-site",
		// Approved timing changes must package/release the website too.
		extraModulePaths: [
			"data/recitation/recitation.sqlite",
			"app/BibleOnSite/Resources/Raw/recitation-audio.html",
			...WEBSITE_ADMIN_SHARED_CONTRACTS,
		],
		ciPaths: [
			...UBUNTU_MIRROR_CI_PATHS,
			...NATIVE_IMAGE_CI_PATHS,
			...DOCKER_BUILD_CI_PATHS,
			...RELEASE_CI_PATHS,
			...E2E_IMPACT_CI_PATHS,
			"devops/github/ci/bencher-comparison.mjs",
			// cd-aws.yml owns the post-deploy verifier invocation contract
			// (NODE_PATH → devops deps) that the deploy_verifier guard replays.
			".github/workflows/cd-aws.yml",
			".github/workflows/website-handover-lock.yml",
			"devops/github/release/website-handover-lock.mjs",
			"devops/github/release/website-handover-lock.test.mjs",
			".github/workflows/shared-dockerize.yml",
			"devops/deploy/ecr-deploy/website-images.mts",
			"devops/deploy/ecr-deploy/api-images.mts",
			"devops/deploy/ecr-deploy/api-images.test.mts",
			"devops/github/ci/website-image-gates.test.mjs",
			"devops/deploy/ecr-deploy/ecr-deployer-base.mts",
			"devops/deploy/ecr-deploy/index.mts",
			"devops/github/release/api-image-assets.mjs",
			"devops/github/release/release-provenance.mjs",
			"devops/github/release/check-deployment.mjs",
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
			/^web\/bible-on-site\/(tests\/|.*\.(test|spec)\.[^/]+$|jest[^/]*\.[^/]*$|playwright[^/]*\.[^/]*$|\.covignore\.mjs$|shared\/typing\/coverage\.d\.ts$|launch-e2e-server\.mts$|scripts\/coverage-gaps\.mjs$|scripts\/start-server-test-kit\.mjs$)/,
	},
	api: {
		directory: "web/api",
		extraModulePaths: ADMIN_API_SHARED_CONTRACTS,
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
			...UBUNTU_MIRROR_CI_PATHS,
			...RELEASE_CI_PATHS,
			".github/workflows/app-package.yml",
			".github/workflows/app-mobile-e2e.yml",
			".github/workflows/app-mobile-e2e-runner.yml",
			"devops/github/ci/audit-android-aab-size.mjs",
			"devops/github/ci/audit-android-aab-size.test.mjs",
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
		// BibleOnSite.DeviceTests is the in-process XHarness test app (#3349) —
		// same test-only status as the BibleOnSite.Tests.* suites.
		ciOnlyPattern:
			/^app\/(BibleOnSite\.Tests[^/]*|BibleOnSite\.DeviceTests|mobile-e2e)\//,
	},
	admin: {
		directory: "web/admin",
		extraModulePaths: [
			...WEBSITE_ADMIN_SHARED_CONTRACTS,
			...ADMIN_API_SHARED_CONTRACTS,
		],
		ciPaths: [
			...UBUNTU_MIRROR_CI_PATHS,
			"devops/github/release/recovery-request.mjs",
			"devops/github/release/recovery-request.test.mjs",
			...NATIVE_IMAGE_CI_PATHS,
			...RELEASE_CI_PATHS,
			...E2E_IMPACT_CI_PATHS,
			...DOCKER_BUILD_CI_PATHS,
			// The dual-platform release contract admin now publishes and consumes:
			// paired archives, provenance binding, and the ECR deployer path.
			".github/workflows/cd-aws.yml",
			"devops/deploy/ecr-deploy/admin-images.mts",
			"devops/deploy/ecr-deploy/api-images.mts",
			"devops/deploy/ecr-deploy/api-images.test.mts",
			"devops/deploy/ecr-deploy/ecr-deployer-base.mts",
			"devops/deploy/ecr-deploy/index.mts",
			"devops/github/release/api-image-assets.mjs",
			"devops/github/release/api-image-assets.test.mjs",
			"devops/github/release/release-provenance.mjs",
			"devops/github/release/check-deployment.mjs",
			"devops/github/ci/admin-image-gates.test.mjs",
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
		ciOnlyPattern: DATA_CI_ONLY_PATTERN,
		// Data deployment tooling and manual migrations require checks.
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
			// The docs-only workflow contract guards the gating this router emits.
			"devops/github/ci/docs-only-gating.test.mjs",
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
const DATA_DEPLOY_PATH = "devops/deploy/data-deploy";
// Manual migrations and their test harnesses take the validation route.
const MANUAL_DATA_MIGRATION_PATH = `${DATA_DEPLOY_PATH}/manual`;
const MYSQL_97_FINGERPRINT_MIGRATION =
	`${MANUAL_DATA_MIGRATION_PATH}/mysql-97-article-fingerprint.sql`;
const ARTICLE_FINGERPRINT_BOOTSTRAP =
	"data/mysql/tanah_article_content_hash_upgrade.sql";
const MYSQL_97_DATA_FILES = new Set([
	ARTICLE_FINGERPRINT_BOOTSTRAP,
	"data/Cargo.lock",
	"data/mysql/db-populator/Cargo.toml",
	"data/mysql/db-populator/src/main.rs",
	"data/mysql/tanah_dynamic_structure.sql",
	"data/mysql/tanah_mention_test_data.sql",
	"data/sefaria/pipelines/perushim-view/README.md",
]);
const DATA_DEPLOY_TEST_PATTERN =
	/(?:^|\/)test_[^/]+\.py$|_test\.py$|\.test\.mts$/;
const DATA_DEPLOY_REGRESSION_SCRIPTS = new Set([
	`${DATA_DEPLOY_PATH}/mysql-fingerprint-regression.mjs`,
	`${DATA_DEPLOY_PATH}/mysql_import_regression.py`,
]);
const DATA_DEPLOY_CI_FILES = new Set([
	".github/workflows/ci-data-deploy.yml",
	".github/workflows/ci.yml",
	"devops/package.json",
	"docs/aws/cloudformation/data-deploy/data-deploy-lambda.py",
	"docs/aws/cloudformation/data-deploy/requirements.txt",
]);

// Root docs/ counts as documentation only for inert prose, media and data
// formats. Source, script, manifest and config extensions never qualify —
// a docs-local executable (the device-tests POC project) or any unknown
// format keeps its validation instead of inheriting the boundary. The
// docs/aws tree is excluded regardless of format: CloudFormation stacks,
// Lambda code and nginx config are deployment/runtime inputs consumed by
// validation, and even its prose/media accompany live infrastructure.
const DOCUMENTATION_PATH =
	/^docs\/(?!aws\/).+\.(?:md|markdown|mdx|txt|rst|adoc|pdf|csv|tsv|json|gz|dbml|puml|drawio|png|jpe?g|gif|svg|webp|ico|bmp|avif|mp4|mov|webm|mp3|wav|m4a|zip|patch|diff)$/i;

// These module directories contain only review prose and screenshots in
// the allowed formats. Runtime assets and benchmark inputs still route by
// module, even when they sit near review notes.
const MODULE_EVIDENCE_DIRECTORIES = [
	"app/docs/evidence",
	"web/admin/docs/evidence",
	"web/bible-on-site/docs/evidence",
	"data/recitation/docs",
	"data/recitation/benchmarks/accumulated-listening-ui",
	"data/recitation/benchmarks/listening-ui",
	"data/recitation/benchmarks/review-version-handoff",
];
const MODULE_EVIDENCE_FILES = new Set([
	"data/recitation/README.md",
	"web/bulletin/docs/daily-bulletin.md",
	"web/bulletin/docs/daily-bulletin-before-after.png",
	"web/bulletin/docs/daily-bulletin-typography-before-after.png",
	"web/bulletin/docs/daily-bulletin-typography-page2.png",
]);
const EVIDENCE_EXTENSION = /\.(?:avif|gif|jpe?g|md|png|webp)$/i;

// Dependency-bot configuration is not deliverable code: a diff confined to the
// Renovate config locations changes no module, dependency graph or runtime
// input, so only Renovate validation should run (#3795). Package and lockfile
// updates keep the ordinary module paths — the classification never matches
// them. Local/custom config inside a module still routes to that module.
const RENOVATE_CONFIG_PATTERN =
	/^(?:renovate\.json5?|\.renovaterc(?:\.json5?)?|\.github\/renovate\.json5?)$/;

// Language inputs for the repo-managed CodeQL workflow (#3795): a pull
// request scans only the languages its diff can actually alter. Dependency
// manifests stay in scope so a dependency change is still scanned. Anything
// outside every map — config-only JSON, docs, Rust, data — resolves to the
// cheapest language so the required code-scanning status still reports.
const CODEQL_LANGUAGE_PATHS: Record<string, RegExp> = {
	actions: /^\.github\/(?:workflows|actions)\//,
	csharp:
		/^app\/|\.(?:cs|csproj|sln|slnx|props|targets|razor|csx|resx|xaml)$|(?:^|\/)global\.json$|(?:^|\/)nuget\.config$/i,
	"javascript-typescript":
		/\.(?:m?ts|tsx|[cm]?js|jsx|d\.ts)$|(?:^|\/)(?:package\.json|bun\.lock|bunfig\.toml|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json)$/i,
	python:
		/\.pyi?$|(?:^|\/)(?:requirements[^/]*\.txt|pyproject\.toml|Pipfile(?:\.lock)?|setup\.py|constraints[^/]*\.txt)$/i,
};

/** Languages whose inputs the diff can alter; never empty for PR scoping. */
export function codeqlLanguages(changedFiles: string[]): string[] {
	const languages = Object.entries(CODEQL_LANGUAGE_PATHS)
		.filter(([, pattern]) => changedFiles.some((file) => pattern.test(file)))
		.map(([language]) => language);
	// The code-scanning ruleset needs a completed CodeQL result for the PR
	// regardless of touched inputs; `actions` is the cheapest complete scan.
	return languages.length ? languages : ["actions"];
}

function isModuleEvidenceDocumentation(file: string): boolean {
	return (
		MODULE_EVIDENCE_FILES.has(file) ||
		(EVIDENCE_EXTENSION.test(file) &&
			MODULE_EVIDENCE_DIRECTORIES.some((directory) => isAt(file, directory)))
	);
}

/** Release intent for data delivery tooling, separate from generic CI checks. */
export function isDataDeployChange(changedFiles: string[]): boolean {
	return changedFiles.some(
		(file) =>
			isAt(file, DATA_DEPLOY_PATH) &&
			!isAt(file, MANUAL_DATA_MIGRATION_PATH) &&
			!DATA_DEPLOY_TEST_PATTERN.test(file) &&
			!DATA_DEPLOY_REGRESSION_SCRIPTS.has(file),
	);
}

export function isDataDeployCiChange(changedFiles: string[]): boolean {
	return changedFiles.some(
		(file) => isAt(file, DATA_DEPLOY_PATH) || DATA_DEPLOY_CI_FILES.has(file),
	);
}

/**
 * Route schema-only data changes to the explicitly approved manual migration path.
 * This path check does not certify SQL safety or existence: deleted migrations
 * also stay manual rather than triggering a full production bootstrap.
 */
export function isSchemaOnlyDataChange(files: string[]): boolean {
	const changedFiles = files.filter(
		(file) =>
			!DATA_CI_ONLY_PATTERN.test(file) && !isModuleEvidenceDocumentation(file),
	);
	if (
		changedFiles.some((file) =>
			MODULES.perushim_pipeline.extraModulePaths.includes(file),
		)
	)
		return false;

	// Switch the existing production fingerprint after the API and admin are
	// deployed. The bootstrap, client pins and fixtures still run their checks.
	const allDataFiles = changedFiles.filter((file) => isAt(file, "data"));
	const hasFingerprintMigration =
		files.includes(MYSQL_97_FINGERPRINT_MIGRATION) &&
		allDataFiles.includes(ARTICLE_FINGERPRINT_BOOTSTRAP);
	if (hasFingerprintMigration && isDataDeployChange(files)) return false;
	const dataFiles = hasFingerprintMigration
		? allDataFiles.filter((file) => !MYSQL_97_DATA_FILES.has(file))
		: allDataFiles;
	if (hasFingerprintMigration && dataFiles.length === 0) return true;

	// Calendar exports are repaired through a guarded date-only database operation.
	// Converter/fixture changes must not launch a replacement production bootstrap.
	const calendarConverter =
		"data/sefaria/pipelines/tanah-view/src/commands/mysql.rs";
	if (
		dataFiles.includes(calendarConverter) &&
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
		"data/mysql/tanah_daily_bulletin_engagement_upgrade.sql",
	]);
	const hasBulletinMigration = dataFiles.some((file) =>
		bulletinMigrations.has(file),
	);
	return (
		dataFiles.length > 0 &&
		dataFiles.every(
			(file) =>
				/^data\/mysql\/tanahpedia_alter_[^/]+\.sql$/.test(file) ||
				// Archive tables use the separately approved selective migration;
				// adding them must not invoke the production data populator.
				file === "data/mysql/private_archive_upgrade.sql" ||
				// Admin initializes its additive contribution table at startup;
				// this migration must not publish the full production data payload.
				file === "data/mysql/tanahpedia_contribution_upgrade.sql" ||
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
							!isModuleEvidenceDocumentation(file) &&
							!(rule.ciOnlyPattern?.test(file) ?? false)) ||
						(rule.extraModulePaths ?? []).some((path) => isAt(file, path)),
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
	// --name-status keeps a rename's source path alongside its destination:
	// moving a file into docs/ still counts the leaving module path, and moving
	// one out of docs/ keeps the docs/ source, so directory moves can never
	// masquerade as documentation-only edits.
	const diff = git("diff", "--name-status", "-M", baseSha, headSha);
	const files = diff
		? diff
				.split("\n")
				.flatMap((line) => line.split("\t").slice(1))
				.filter((file) => file.length > 0)
		: [];
	return { baseSha, headSha, files };
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
	// Inert documentation requests no automatic validation when every
	// touched path (rename sources included) falls within a documentation
	// boundary and nothing routed any module's checks (#3621).
	// The merge-group diff already spans the combined candidate — a
	// batched code entry keeps docs_only false — while a tail group's own
	// docs-only delta may skip because ALLGREEN requires every earlier entry's
	// checks green before this group can merge.
	const docsOnly =
		files.length > 0 &&
		files.every(
			(file) =>
				DOCUMENTATION_PATH.test(file) || isModuleEvidenceDocumentation(file),
		) &&
		!Object.values(changes).some(
			(flags) => flags.module_changed || flags.ci_changed,
		);
	// A diff confined to Renovate configuration validates the config itself
	// only: no module flag may fire, and like docs_only the merge-group diff
	// already spans the combined candidate (#3795).
	const renovateConfigOnly =
		files.length > 0 &&
		files.every((file) => RENOVATE_CONFIG_PATTERN.test(file)) &&
		!Object.values(changes).some(
			(flags) => flags.module_changed || flags.ci_changed,
		);
	if (mergeGroup && !docsOnly && !renovateConfigOnly) {
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
	// The queue event base can already contain an earlier unmerged entry.
	// The required rehearsals must cover deployment inputs from that entry too.
	const dataDeployCiChanged =
		isDataDeployCiChange(files) ||
		(mergeGroup &&
			isDataDeployCiChange(
				listChangedFiles({ kind: "branch", branch: "master" }, cwd),
			));
	lines.push(`data_deploy_ci_changed=${dataDeployCiChanged}`);
	lines.push(`docs_only=${docsOnly}`);
	lines.push(`renovate_config_only=${renovateConfigOnly}`);
	lines.push(
		`codeql_languages=${JSON.stringify(codeqlLanguages(deliveryFiles))}`,
	);
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
