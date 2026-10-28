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
	isDataDeployChange,
	isSchemaOnlyDataChange,
	MODULES,
	type ModuleKey,
	main,
} from "./determine-changes.ts";

const changed = (files: string[], ...keys: ModuleKey[]) =>
	keys.map((key) => detectChanges(files)[key]);

describe("detectChanges", () => {
	test("the annotation evaluation guide selects data checks without delivery", () => {
		const files = ["data/annotations/GOLDEN.md"];
		const changes = detectChanges(files);
		assert.deepEqual(changes.data, { module_changed: false, ci_changed: true });
		for (const [key, flags] of Object.entries(changes)) {
			if (key !== "data")
				assert.deepEqual(
					flags,
					{ module_changed: false, ci_changed: false },
					key,
				);
		}
		assert.equal(isDataDeployChange(files), false);
		assert.equal(isSchemaOnlyDataChange(files), false);
	});

	test("the guide exception preserves real annotation inputs and exact path boundaries", () => {
		for (const file of [
			"data/annotations/publish.py",
			"data/annotations/golden/metrics-baseline.json",
			"data/annotations/GOLDEN.md.bak",
			"data/annotations/nested/GOLDEN.md",
		]) {
			assert.deepEqual(
				detectChanges([file]).data,
				{ module_changed: true, ci_changed: false },
				file,
			);
			assert.deepEqual(
				detectChanges(["data/annotations/GOLDEN.md", file]).data,
				{ module_changed: true, ci_changed: true },
				file,
			);
		}
	});

	test("the guide does not turn a manual migration into a full data deployment", () => {
		const files = [
			"data/annotations/GOLDEN.md",
			"data/mysql/tanahpedia_alter_mention_decoration.sql",
		];
		assert.deepEqual(detectChanges(files).data, {
			module_changed: true,
			ci_changed: true,
		});
		assert.equal(isSchemaOnlyDataChange(files), true);
		assert.equal(
			isSchemaOnlyDataChange([
				...files,
				"data/mysql/tanah_sefarim_and_perakim_data.sql",
			]),
			false,
		);
	});

	test("native image validation changes select all three services without a release", () => {
		for (const file of [
			".github/workflows/architecture-validation.yml",
			"devops/github/ci/verify-native-image.mjs",
			"devops/github/ci/verify-native-image.test.mjs",
			"devops/github/ci/verify-website-native.mjs",
		]) {
			const changes = detectChanges([file]);
			for (const [key, flags] of Object.entries(changes)) {
				assert.deepEqual(
					flags,
					{
						module_changed: false,
						ci_changed: ["website", "api", "admin"].includes(key),
					},
					`${file} -> ${key}`,
				);
			}
		}
	});

	test("playback derivatives release both website and native book packages", () => {
		assert.deepEqual(
			changed(
				["web/bible-on-site/src/data/recitation/opus-playback.json"],
				"website",
				"app",
			),
			[
				{ module_changed: true, ci_changed: false },
				{ module_changed: true, ci_changed: false },
			],
		);
	});
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

	test("an action-only change selects every module's checks without releasing it", () => {
		// Composite actions under .github/actions are consumed by jobs across
		// every module — an lcov-image-only PR must still run their consumers.
		const changes = detectChanges([".github/actions/lcov-image/action.yml"]);
		for (const [key, flags] of Object.entries(changes)) {
			assert.deepEqual(flags, { module_changed: false, ci_changed: true }, key);
		}
	});

	test("mobile matrix workflow changes require app checks without a release", () => {
		const changes = detectChanges([".github/workflows/app-mobile-e2e.yml"]);
		assert.deepEqual(changes.app, { module_changed: false, ci_changed: true });
		assert.equal(changes.website.ci_changed, false);
	});

	test("device runner workflow changes require app checks without a release", () => {
		// #2373: the runner owns emulator/install logic and the Release startup
		// smoke leg — a runner-only edit must not skip the checks it hosts.
		const changes = detectChanges([
			".github/workflows/app-mobile-e2e-runner.yml",
		]);
		assert.deepEqual(changes.app, { module_changed: false, ci_changed: true });
		assert.equal(changes.website.ci_changed, false);
	});

	test("deployment workflow changes require website checks without a release", () => {
		// cd-aws.yml owns the verifier's NODE_PATH contract (#2372).
		const changes = detectChanges([".github/workflows/cd-aws.yml"]);
		assert.deepEqual(changes.website, {
			module_changed: false,
			ci_changed: true,
		});
	});

	test("calendar-PDF publish workflow changes require website checks without a release", () => {
		// The publisher defines the generation/publish contract verified by the
		// calendar_pdf_artifacts job (#2608) — CI-only, never a website release.
		const changes = detectChanges([
			".github/workflows/calendar-pdf-publish.yml",
		]);
		assert.deepEqual(changes.website, {
			module_changed: false,
			ci_changed: true,
		});
	});

	test("nginx redirects select the deploy verifier guard without a website release", () => {
		const changes = detectChanges([
			"docs/aws/cloudformation/ec2-nginx/router/router.conf",
		]);
		assert.deepEqual(changes.website, {
			module_changed: false,
			ci_changed: true,
		});
	});

	test("devops manifest changes select the deploy verifier guard", () => {
		for (const file of ["devops/package.json", "devops/bun.lock"]) {
			assert.equal(detectChanges([file]).admin.ci_changed, true, file);
		}
	});

	test("packaging workflow changes require app signing checks without a release", () => {
		const changes = detectChanges([".github/workflows/app-package.yml"]);
		assert.deepEqual(changes.app, { module_changed: false, ci_changed: true });
		for (const [key, flags] of Object.entries(changes)) {
			if (key !== "app")
				assert.deepEqual(flags, { module_changed: false, ci_changed: false });
		}
	});

	test("downloader sources and signing declarations require native packaging", () => {
		for (const file of [
			"app/extensions/AssetPackDownloader/AssetPackDownloader/DownloaderExtension.swift",
			"app/extensions/AssetPackDownloader/AssetPackDownloader/Info.plist",
			"app/extensions/AssetPackDownloader/AssetPackDownloader/AssetPackDownloader.entitlements",
			"app/BibleOnSite/Platforms/iOS/Entitlements.App.plist",
			"app/devops/verify_ios_signing.py",
		]) {
			assert.deepEqual(
				detectChanges([file]).app,
				{ module_changed: true, ci_changed: false },
				file,
			);
		}
	});

	test("e2e-impact selector changes check every served suite without a release", () => {
		// The devops selector drives Appium too; web/shared/tests-util feeds
		// only the Playwright suites, so it does not mark the app.
		for (const [file, marksApp] of [
			["devops/github/ci/e2e-impact/select.ts", true],
			["devops/github/ci/e2e-impact/e2e-impact.test.ts", true],
			["web/shared/tests-util/e2e-impact.ts", false],
		] as const) {
			const changes = detectChanges([file]);
			for (const key of ["website", "api", "admin"] as const) {
				assert.deepEqual(
					changes[key],
					{ module_changed: false, ci_changed: true },
					`${file} -> ${key}`,
				);
			}
			assert.deepEqual(
				changes.app,
				{ module_changed: false, ci_changed: marksApp },
				`${file} -> app`,
			);
		}
		for (const file of [
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
		"web/bible-on-site/bun.lock",
		"web/bible-on-site/src/lib/recitation-audio.ts",
	]) {
		test(`${path} no longer selects native checks`, () => {
			// The decoder manifest is app-owned (#2391): website manifests and the
			// browser player must not fan out to the Android/iOS matrix.
			assert.deepEqual(changed([path], "app"), [
				{ module_changed: false, ci_changed: false },
			]);
		});
	}

	test("a website-only version bump runs no app check", () => {
		const changes = detectChanges([
			"web/bible-on-site/package.json",
			"web/bible-on-site/bun.lock",
		]);
		assert.deepEqual(changes.app, {
			module_changed: false,
			ci_changed: false,
		});
	});

	for (const path of [
		"app/devops/recitation-decoder/package.json",
		"app/devops/recitation-decoder/bun.lock",
		"app/devops/recitation-decoder/build-native-recitation-decoder.mjs",
		"app/devops/recitation-decoder/disabled-opus-ml.mjs",
		"app/devops/recitation-decoder/check-decoder-pins.mjs",
	]) {
		test(`${path} releases the app with its regenerated decoder`, () => {
			assert.deepEqual(changed([path], "app"), [
				{ module_changed: true, ci_changed: false },
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

	test("native release notes include every external packaged input", () => {
		const ci = readFileSync(
			new URL("../../../.github/workflows/ci.yml", import.meta.url),
			"utf8",
		).replace(/\r/g, "");
		const release = ci
			.split("  release_app:\n")[1]
			.split("\n  release_bulletin:")[0];
		const match = release.match(/^ {6}extra_module_paths: '([^']+)'$/m);
		assert.ok(match, "Native packaged inputs must be passed to release notes");
		assert.deepEqual(JSON.parse(match[1]), [
			"data/recitation/recitation.sqlite",
			"web/bible-on-site/src/data/recitation/opus-playback.json",
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
		"web/bible-on-site/bun.lock",
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

	test("release Docker build inputs validate the affected images without releasing", () => {
		for (const [file, keys] of [
			["web/.dockerignore", ["website", "api", "bulletin", "admin"]],
			[".github/workflows/shared-dockerize.yml", ["api"]],
			["web/api/entities/src/lib.rs", ["bulletin"]],
		] as const) {
			const changes = detectChanges([file]);
			for (const key of keys) {
				assert.deepEqual(
					changes[key],
					{ module_changed: false, ci_changed: true },
					`${file} -> ${key}`,
				);
			}
		}
		for (const key of ["api", "bulletin", "admin"] as const) {
			const dockerfile = `web/${key}/Dockerfile`;
			assert.equal(
				detectChanges([dockerfile])[key].module_changed,
				true,
				dockerfile,
			);
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

	test("ECR deployer changes run recovery checks without data delivery or a release", () => {
		for (const file of [
			"devops/deploy/ecr-deploy/ecr-client.mts",
			"devops/deploy/ecr-deploy/ecr-client.test.mts",
			"devops/deploy/ecr-deploy/resume-image.mts",
			"devops/deploy/ecr-deploy/resume-image.test.mts",
		]) {
			const changes = detectChanges([file]);
			for (const [key, flags] of Object.entries(changes)) {
				assert.deepEqual(
					flags,
					{ module_changed: false, ci_changed: key === "data" },
					`${file} -> ${key}`,
				);
			}
			assert.equal(isDataDeployChange([file]), false, file);
		}
		assert.equal(
			detectChanges(["devops/deploy/ecr-deploy-old.mts"]).data.ci_changed,
			false,
		);
	});

	test("module directories match path segments, not prefixes", () => {
		const changes = detectChanges(["web/api-docs/readme.md", "appendix.md"]);
		assert.equal(changes.api.module_changed, false);
		assert.equal(changes.app.module_changed, false);
	});

	test("bundled scripture changes regenerate the delivered search index", () => {
		const changes = detectChanges([
			"app/BibleOnSite/Resources/Raw/sefaria-dump-5784-sivan-4.tanah_view.sqlite",
		]);
		assert.equal(changes.perushim_pipeline.module_changed, true);
		assert.equal(changes.app.module_changed, true);
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

describe("isSchemaOnlyDataChange", () => {
	for (const [name, files, expected] of [
		["no data changes", [], false],
		[
			"tooling-only changes retain normal deployment behavior",
			[
				"devops/deploy/data-deploy/sql-files.json",
				"docs/aws/cloudformation/data-deploy/data-deploy-lambda.py",
				"devops/deploy/README.md",
			],
			false,
		],
		[
			"schema recovery with associated tooling and documentation",
			[
				"data/mysql/tanahpedia_alter_mention_decoration.sql",
				"devops/deploy/data-deploy/sql-files.json",
				"devops/deploy/data-deploy/index.mts",
				"devops/deploy/data-deploy/test_lambda_parser.py",
				"docs/aws/cloudformation/data-deploy/data-deploy-lambda.py",
				"devops/deploy/README.md",
				".github/workflows/ci.yml",
			],
			true,
		],
		[
			"multiple schema migrations",
			[
				"data/mysql/tanahpedia_alter_mention_decoration.sql",
				"data/mysql/tanahpedia_alter_source_citation.sql",
			],
			true,
		],
		[
			"bulletin upgrade with bootstrap preservation tests stays manual",
			[
				"data/mysql/tanah_daily_bulletin_upgrade.sql",
				"data/mysql/db-populator/src/main.rs",
				"web/admin/src/server/ses-delivery.server.ts",
			],
			true,
		],
		[
			"bulletin upgrade alone stays manual",
			["data/mysql/tanah_daily_bulletin_upgrade.sql"],
			true,
		],
		[
			"bootstrap changes alone retain normal deployment behavior",
			["data/mysql/db-populator/src/main.rs"],
			false,
		],
		[
			"bulletin upgrade cannot hide production content changes",
			[
				"data/mysql/tanah_daily_bulletin_upgrade.sql",
				"data/mysql/db-populator/src/main.rs",
				"data/mysql/tanah_sefarim_and_perakim_data.sql",
			],
			false,
		],
		[
			"schema plus static SQL requires full deployment",
			[
				"data/mysql/tanahpedia_alter_mention_decoration.sql",
				"data/mysql/tanah_static_structure.sql",
			],
			false,
		],
		[
			"schema plus pipeline changes requires full deployment",
			[
				"data/mysql/tanahpedia_alter_mention_decoration.sql",
				"data/sefaria/pipelines/perushim-view/src/main.rs",
			],
			false,
		],
		[
			"schema plus external pipeline scripture requires full deployment",
			[
				"data/mysql/tanahpedia_alter_mention_decoration.sql",
				...MODULES.perushim_pipeline.extraModulePaths,
			],
			false,
		],
		[
			"scripture data requires full deployment",
			["data/mysql/tanah_sefarim_and_perakim_data.sql"],
			false,
		],
		[
			"recitation data retains normal deployment behavior",
			["data/recitation/recitation.sqlite"],
			false,
		],
		[
			"nested migration names do not qualify",
			["data/mysql/nested/tanahpedia_alter_mention_decoration.sql"],
			false,
		],
		[
			"non-SQL migration names do not qualify",
			["data/mysql/tanahpedia_alter_mention_decoration.sql.bak"],
			false,
		],
		[
			"an empty migration name does not qualify",
			["data/mysql/tanahpedia_alter_.sql"],
			false,
		],
		["data path itself does not qualify", ["data"], false],
	] as const) {
		test(name, () => {
			assert.equal(isSchemaOnlyDataChange([...files]), expected);
		});
	}

	test("the workflow skips the entire release job only for an explicit full-data decision", () => {
		const ci = readFileSync(
			new URL("../../../.github/workflows/ci.yml", import.meta.url),
			"utf8",
		).replace(/\r/g, "");
		assert.match(
			ci,
			/^ {6}data_schema_only_changed: \$\{\{ steps\.determine\.outputs\.data_schema_only_changed \}\}$/m,
		);
		const release = ci
			.split("  release_data:\n")[1]
			.split("\n  bump_versions:")[0];
		const condition = release.match(/^ {4}if: (.+)$/m)?.[1];
		assert.ok(condition, "Data release requires a job-level condition");
		assert.ok(
			condition.includes(
				"needs.determine_changes.outputs.data_schema_only_changed == 'false'",
			),
		);
	});
});

test("SES infrastructure changes select data checks without releasing content", () => {
	for (const file of [
		"docs/aws/cloudformation/daily-bulletin-ses.yaml",
		"devops/daily-bulletin-infra.test.mjs",
		"web/bulletin/assets/email/manifest.json",
		"web/bulletin/scripts/prepare-email-assets.mjs",
		"app/BibleOnSite/Resources/Images/logo_header.jpg",
		"web/bible-on-site/public/icons/envelope.svg",
		"web/bible-on-site/public/icons/phone.svg",
		"web/bible-on-site/public/icons/whatsapp.svg",
		"web/bible-on-site/public/icons/telegram.svg",
	]) {
		const changes = detectChanges([file]);
		assert.equal(changes.data.ci_changed, true);
		assert.equal(changes.data.module_changed, false);
		assert.equal(isDataDeployChange([file]), false);
	}
});

describe("isDataDeployChange", () => {
	test("data-deploy tooling changes signal delivery intent", () => {
		assert.equal(
			isDataDeployChange(["devops/deploy/data-deploy/index.mts"]),
			true,
		);
		assert.equal(
			isDataDeployChange(["devops/deploy/data-deploy/sql-files.json"]),
			true,
		);
	});

	test("shared CI plumbing and data content are not delivery intent", () => {
		// #2730: a shared-CI-only push (ci.yml, composite actions, the detector
		// itself) skips the perushim producer and must not enter Release Data.
		for (const files of [
			SHARED_FILES,
			["data/mysql/tanah_static_structure.sql"],
			["devops/deploy/deployer-base.mts"],
			["devops/deploy/data-deploy-old.mts"],
			[],
		])
			assert.equal(isDataDeployChange(files), false, JSON.stringify(files));
	});
});

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
		changeKind: "write" | "delete" = "write",
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
			const root = commit(
				work,
				changeKind === "delete" ? changedPath : "README.md",
			);
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
			} else if (changeKind === "delete") {
				rmSync(join(work, changedPath));
				git(work, "add", ".");
				git(work, "commit", "--quiet", "-m", "Remove migration");
			} else {
				commit(work, changedPath);
			}
			// Use the Git transport so background maintenance cannot race a loose-object copy.
			git(directory, "clone", "--quiet", "--no-local", "--bare", work, origin);
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
				Object.keys(MODULES).length * 2 + 2,
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
		assert.match(output, /^data_schema_only_changed=false$/m);
		assert.match(output, /^admin_module_changed=false$/m);
		assert.match(output, /^bulletin_module_changed=false$/m);
	});

	for (const changeKind of ["write", "delete"] as const) {
		test(
			"an annotation guide " + changeKind + " emits CI-only data outputs",
			() => {
				const { changes, output } = run(
					"push",
					({ base }) => ({ before: base }),
					"data/annotations/GOLDEN.md",
					changeKind,
				);
				assert.deepEqual(changes.data, {
					module_changed: false,
					ci_changed: true,
				});
				assert.match(output, /^data_module_changed=false$/m);
				assert.match(output, /^data_ci_changed=true$/m);
				assert.match(output, /^data_deploy_changed=false$/m);
				assert.match(output, /^data_schema_only_changed=false$/m);
			},
		);
	}

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

	test("a schema-only push stays selected for data checks and emits the manual deployment decision", () => {
		const { changes, output } = run(
			"push",
			({ base }) => ({ before: base }),
			"data/mysql/tanahpedia_alter_mention_decoration.sql",
		);
		assert.deepEqual(changes.data, { module_changed: true, ci_changed: false });
		assert.match(output, /^data_schema_only_changed=true$/m);
	});

	test("a deleted schema migration stays manual without asserting the SQL still exists", () => {
		const { changes, output } = run(
			"push",
			({ base }) => ({ before: base }),
			"data/mysql/tanahpedia_alter_mention_decoration.sql",
			"delete",
		);
		assert.deepEqual(changes.data, { module_changed: true, ci_changed: false });
		assert.match(output, /^data_schema_only_changed=true$/m);
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
