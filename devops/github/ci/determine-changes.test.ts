import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import {
	baseRevision,
	detectChanges,
	MODULES,
	type ModuleKey,
	main,
} from "./determine-changes.ts";

const changed = (files: string[], ...keys: ModuleKey[]) =>
	keys.map((key) => detectChanges(files)[key]);

describe("detectChanges", () => {
	test("benchmark comparison changes check the website without releasing a module", () => {
		const changes = detectChanges(["devops/github/ci/bencher-comparison.mjs"]);
		assert.deepEqual(changes.website, {
			module_changed: false,
			ci_changed: true,
		});
		for (const [key, flags] of Object.entries(changes)) {
			if (key !== "website")
				assert.deepEqual(flags, { module_changed: false, ci_changed: false });
		}
	});

	test("mobile matrix workflow changes require app checks without a release", () => {
		const changes = detectChanges([".github/workflows/app-mobile-e2e.yml"]);
		assert.deepEqual(changes.app, { module_changed: false, ci_changed: true });
		assert.equal(changes.website.ci_changed, false);
	});

	test("e2e-impact selector changes require app checks without a release", () => {
		for (const file of [
			"devops/github/ci/e2e-impact/select.ts",
			"devops/github/ci/e2e-impact/e2e-impact.test.ts",
			"devops/e2e-coverage-trees/extract.ts",
			"devops/e2e-coverage-trees/to-selector-tree.ts",
		]) {
			const changes = detectChanges([file]);
			assert.deepEqual(
				changes.app,
				{ module_changed: false, ci_changed: true },
				file,
			);
			assert.equal(changes.website.ci_changed, false, file);
		}
	});

	for (const path of [
		"web/bible-on-site/package.json",
		"web/bible-on-site/package-lock.json",
		"web/bible-on-site/src/lib/recitation-audio.ts",
	]) {
		test(`${path} checks the decoder without releasing the app`, () => {
			assert.deepEqual(changed([path], "app"), [
				{ module_changed: false, ci_changed: true },
			]);
		});
	}

	test("approved timings release both website and native app without a version-file change", () => {
		assert.deepEqual(
			changed(["data/recitation/recitation.sqlite"], "website", "app", "data"),
			[
				{ module_changed: true, ci_changed: false },
				{ module_changed: true, ci_changed: false },
				{ module_changed: true, ci_changed: false },
			],
		);
	});

	test("held diagnostics and sibling names cannot release the native app", () => {
		for (const file of [
			"data/recitation/recitation.sqlite.bak",
			"data/recitation/.outputs/held.json",
		]) {
			assert.equal(detectChanges([file]).app.module_changed, false, file);
		}
	});

	test("native release notes include every external packaged timing input", () => {
		const ci = readFileSync(
			new URL("../../../.github/workflows/ci.yml", import.meta.url),
			"utf8",
		).replace(/\r/g, "");
		const release = ci
			.split("  release_app:\n")[1]
			.split("\n  release_bulletin:")[0];
		const match = release.match(/^      extra_module_paths: '([^']+)'$/m);
		assert.ok(match, "Native timing inputs must be passed to release notes");
		assert.deepEqual(JSON.parse(match[1]), [
			"data/recitation/recitation.sqlite",
		]);
	});

	test("a packaged decoder change releases the app", () => {
		assert.deepEqual(
			changed(["app/BibleOnSite/Resources/Raw/recitation-mpeg.min.js"], "app"),
			[{ module_changed: true, ci_changed: false }],
		);
	});

	test("native audio bridge changes release both dependent modules", () => {
		const path = "app/BibleOnSite/Resources/Raw/recitation-audio.html";
		assert.deepEqual(changed([path], "app", "website"), [
			{ module_changed: true, ci_changed: false },
			{ module_changed: true, ci_changed: false },
		]);
	});

	test("unrelated website UI does not run app checks", () => {
		assert.deepEqual(changed(["web/bible-on-site/src/app/page.tsx"], "app"), [
			{ module_changed: false, ci_changed: false },
		]);
	});

	for (const path of [
		"app/BibleOnSite.Tests/Services/ArticleSearchServiceTests.cs",
		"app/BibleOnSite.Tests.E2E/Navigation/ArticlesNavigationTests.cs",
		"app/BibleOnSite.Tests.MobileE2E/PerekPilotTests.cs",
		"app/mobile-e2e/run.mjs",
	]) {
		test(`${path} runs app checks without a store release`, () => {
			assert.deepEqual(changed([path], "app"), [
				{ module_changed: false, ci_changed: true },
			]);
		});
	}

	test("packaged app changes still release alongside test changes", () => {
		assert.deepEqual(
			changed(
				[
					"app/BibleOnSite/Pages/PerekPage.xaml",
					"app/BibleOnSite.Tests/Services/PerekServiceTests.cs",
				],
				"app",
			),
			[{ module_changed: true, ci_changed: true }],
		);
	});

	test("app build tooling changes still release the app", () => {
		assert.deepEqual(changed(["app/devops/Build.Package.cs"], "app"), [
			{ module_changed: true, ci_changed: false },
		]);
	});

	for (const path of [
		// The tests/ tree, including its coverage fixtures.
		"web/bible-on-site/tests/unit/components/TopNav.test.tsx",
		"web/bible-on-site/tests/e2e/search.test.ts",
		"web/bible-on-site/tests/integration/lib/bulletin-client.test.ts",
		"web/bible-on-site/tests/perf/build-size.test.ts",
		"web/bible-on-site/tests/util/coverage/merge-coverage.mts",
		// Colocated *.test.* / *.spec.* files anywhere in the module.
		"web/bible-on-site/scripts/start-server.test.mjs",
		"web/bible-on-site/scripts/verify-public-content.test.mjs",
		"web/bible-on-site/src/lib/search/service.spec.ts",
		// The jest harness.
		"web/bible-on-site/jest.config.js",
		"web/bible-on-site/jest.setup.js",
		"web/bible-on-site/jest-dom.setup.js",
		"web/bible-on-site/jest.coverage-setup.js",
		// The playwright harness and the e2e-only helpers it imports.
		"web/bible-on-site/playwright.base.config.ts",
		"web/bible-on-site/playwright.e2e.config.ts",
		"web/bible-on-site/playwright.perf.config.ts",
		"web/bible-on-site/playwright.recitation.config.ts",
		"web/bible-on-site/playwright-global-setup.js",
		"web/bible-on-site/playwright-global-teardown-coverage.js",
		"web/bible-on-site/launch-e2e-server.mts",
		"web/bible-on-site/get-debug-port.js",
		// Test env and coverage fixtures.
		"web/bible-on-site/.test.env",
		"web/bible-on-site/.covignore.mjs",
		"web/bible-on-site/shared/typing/coverage.d.ts",
	]) {
		test(`${path} runs website checks without a release`, () => {
			assert.deepEqual(changed([path], "website"), [
				{ module_changed: false, ci_changed: true },
			]);
		});
	}

	for (const path of [
		"web/bible-on-site/package.json",
		"web/bible-on-site/package-lock.json",
		"web/bible-on-site/next.config.mjs",
		"web/bible-on-site/tsconfig.json",
		"web/bible-on-site/biome.json",
		"web/bible-on-site/.dev.env",
		"web/bible-on-site/.npmrc",
		"web/bible-on-site/Dockerfile",
		"web/bible-on-site/src/app/page.tsx",
		"web/bible-on-site/src/lib/recitation-audio.ts",
		"web/bible-on-site/src/util/latest.ts",
		"web/bible-on-site/public/icons/search.svg",
		"web/bible-on-site/scripts/start-server.mjs",
		"web/bible-on-site/scripts/generate-client-catalog.mjs",
		"web/bible-on-site/scripts/coverage-gaps.mjs",
		"web/bible-on-site/shared/typing/other.d.ts",
		"web/bible-on-site/tests2/util/helper.ts",
	]) {
		test(`${path} still releases the website`, () => {
			assert.deepEqual(changed([path], "website"), [
				{ module_changed: true, ci_changed: false },
			]);
		});
	}

	test("packaged website changes still release alongside test changes", () => {
		assert.deepEqual(
			changed(
				[
					"web/bible-on-site/src/app/page.tsx",
					"web/bible-on-site/tests/unit/components/TopNav.test.tsx",
				],
				"website",
			),
			[{ module_changed: true, ci_changed: true }],
		);
	});

	test("CI workflow and detection changes validate every module without releasing it", () => {
		for (const path of SHARED_FILES) {
			for (const flags of Object.values(detectChanges([path]))) {
				assert.deepEqual(flags, { module_changed: false, ci_changed: true });
			}
		}
	});

	test("release workflow changes validate only released modules", () => {
		const changes = detectChanges([".github/workflows/shared-release.yml"]);
		for (const key of ["website", "api", "app", "bulletin"] as const) {
			assert.equal(changes[key].ci_changed, true, key);
		}
		for (const key of ["admin", "data", "perushim_pipeline"] as const) {
			assert.equal(changes[key].ci_changed, false, key);
		}
	});

	test("directory CI paths match nested files only", () => {
		assert.equal(
			detectChanges(["devops/rustfs/policy.json"]).admin.ci_changed,
			true,
		);
		assert.equal(
			detectChanges(["devops/deploy/data-deploy/index.mts"]).data.ci_changed,
			true,
		);
		assert.equal(
			detectChanges(["devops/deploy/data-deploy-old.mts"]).data.ci_changed,
			false,
		);
	});

	test("module directories match path segments, not prefixes", () => {
		const changes = detectChanges(["web/api-docs/readme.md", "appendix.md"]);
		assert.equal(changes.api.module_changed, false);
		assert.equal(changes.app.module_changed, false);
	});

	test("the perushim pipeline is also part of the data module", () => {
		const changes = detectChanges([
			"data/sefaria/pipelines/perushim-view/src/main.rs",
		]);
		assert.equal(changes.perushim_pipeline.module_changed, true);
		assert.equal(changes.data.module_changed, true);
	});
});

const SHARED_FILES = [
	".github/workflows/ci.yml",
	"devops/github/ci/determine-changes.ts",
];

describe("baseRevision", () => {
	test("uses the tested PR merge parent even when the event base is stale", () => {
		assert.deepEqual(
			baseRevision("pull_request", { pull_request: { base: { sha: "a1" } } }),
			{ kind: "merge-parent" },
		);
	});

	test("uses the commit before a push", () => {
		assert.deepEqual(baseRevision("push", { before: "b2" }), {
			kind: "sha",
			sha: "b2",
		});
	});

	test("uses HEAD's parent when the pushed ref was created", () => {
		assert.deepEqual(baseRevision("push", { before: "0".repeat(40) }), {
			kind: "parent",
		});
	});

	test("uses the merge-queue base", () => {
		assert.deepEqual(
			baseRevision("merge_group", { merge_group: { base_sha: "c3" } }),
			{ kind: "sha", sha: "c3" },
		);
	});

	test("uses master for manual runs", () => {
		assert.deepEqual(baseRevision("workflow_dispatch", {}), {
			kind: "branch",
			branch: "master",
		});
	});

	test("rejects a payload without its base", () => {
		assert.throws(
			() => baseRevision("merge_group", {}),
			/merge_group.base_sha/,
		);
	});
});

describe("main", () => {
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

	function commit(cwd: string, path: string) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), `${path}\n`);
		git(cwd, "add", ".");
		git(cwd, "commit", "--quiet", "-m", path);
		return git(cwd, "rev-parse", "HEAD");
	}

	/**
	 * Builds origin history `base -> (api change) -> (website change)` on master,
	 * then runs `main` in a depth-1 clone of HEAD, like actions/checkout. PRs
	 * use a synthetic merge whose first parent has newer release-only bumps.
	 */
	function run(
		eventName: string,
		event: (shas: { root: string; replaced: string; base: string }) => object,
		changedPath = "web/bible-on-site/src/page.tsx",
	) {
		const directory = mkdtempSync(join(tmpdir(), "determine-changes-"));
		try {
			const work = join(directory, "work");
			const origin = join(directory, "origin.git");
			const clone = join(directory, "clone");
			mkdirSync(work);
			git(work, "init", "--quiet", "--initial-branch=master");
			git(work, "config", "user.name", "CI fixture");
			git(work, "config", "user.email", "ci-fixture@example.invalid");
			git(work, "config", "core.autocrlf", "false");
			const root = commit(work, "README.md");
			git(work, "checkout", "--quiet", "-b", "replaced");
			const replaced = commit(work, "web/admin/src/main.tsx");
			git(work, "checkout", "--quiet", "master");
			const base = commit(work, "web/api/src/main.rs");
			if (eventName === "pull_request") {
				git(work, "checkout", "--quiet", "-b", "feature");
				commit(work, "web/bible-on-site/src/page.tsx");
				git(work, "checkout", "--quiet", "master");
				commit(work, "web/admin/package.json");
				commit(work, "web/bulletin/Cargo.toml");
				git(
					work,
					"merge",
					"--no-ff",
					"--quiet",
					"feature",
					"-m",
					"Tested PR merge",
				);
			} else {
				commit(work, changedPath);
			}
			git(directory, "clone", "--quiet", "--bare", work, origin);
			// A force push leaves the replaced commit unreachable from any ref.
			git(origin, "branch", "--quiet", "-D", "replaced");
			// GitHub serves fetches of commits by SHA.
			git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
			git(
				directory,
				"clone",
				"--quiet",
				"--depth=1",
				`file://${origin.replace(/\\/g, "/")}`,
				clone,
			);
			const eventPath = join(directory, "event.json");
			const outputPath = join(directory, "output.txt");
			writeFileSync(eventPath, JSON.stringify(event({ root, replaced, base })));
			const changes = main(
				{
					GITHUB_EVENT_NAME: eventName,
					GITHUB_EVENT_PATH: eventPath,
					GITHUB_OUTPUT: outputPath,
				},
				clone,
			);
			const output = readFileSync(outputPath, "utf8");
			assert.equal(
				output.trim().split("\n").length,
				Object.keys(MODULES).length * 2,
			);
			return { changes, output };
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}

	const websiteOnly = (changes: ReturnType<typeof detectChanges>) =>
		assert.deepEqual(
			Object.entries(changes)
				.filter(([, flags]) => flags.module_changed)
				.map(([key]) => key),
			["website"],
		);
	const apiAndWebsite = (changes: ReturnType<typeof detectChanges>) =>
		assert.deepEqual(
			Object.entries(changes)
				.filter(([, flags]) => flags.module_changed)
				.map(([key]) => key),
			["website", "api"],
		);

	test("pull_request excludes newer master-only version bumps in a shallow tested merge", () => {
		const { changes, output } = run("pull_request", ({ base }) => ({
			pull_request: { base: { sha: base } },
		}));
		websiteOnly(changes);
		assert.match(output, /^website_module_changed=true$/m);
		assert.match(output, /^api_module_changed=false$/m);
		assert.match(output, /^website_ci_changed=false$/m);
		assert.match(output, /^admin_module_changed=false$/m);
		assert.match(output, /^bulletin_module_changed=false$/m);
	});

	test("a timing-only master push schedules native packaging with unchanged app version", () => {
		const { changes, output } = run(
			"push",
			({ base }) => ({ before: base }),
			"data/recitation/recitation.sqlite",
		);
		assert.deepEqual(
			Object.entries(changes)
				.filter(([, flags]) => flags.module_changed)
				.map(([key]) => key),
			["website", "app", "data"],
		);
		assert.match(output, /^app_module_changed=true$/m);
		assert.match(output, /^website_module_changed=true$/m);
	});

	test("push compares with the commit before the push", () => {
		apiAndWebsite(run("push", ({ root }) => ({ before: root })).changes);
	});

	test("a force push compares with the replaced commit", () => {
		const { changes } = run("push", ({ replaced }) => ({ before: replaced }));
		assert.deepEqual(
			Object.entries(changes)
				.filter(([, flags]) => flags.module_changed)
				.map(([key]) => key),
			["website", "api", "admin"],
		);
	});

	test("push of a new ref compares with HEAD's parent", () => {
		websiteOnly(run("push", () => ({ before: "0".repeat(40) })).changes);
	});

	test("merge_group compares with the queue base", () => {
		websiteOnly(
			run("merge_group", ({ base }) => ({ merge_group: { base_sha: base } }))
				.changes,
		);
	});

	test("workflow_dispatch compares with master", () => {
		const { changes } = run("workflow_dispatch", () => ({}));
		for (const flags of Object.values(changes)) {
			assert.deepEqual(flags, { module_changed: false, ci_changed: false });
		}
	});
});
