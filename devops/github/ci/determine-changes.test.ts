import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	baseRevision,
	detectChanges,
	isDataDeployChange,
	isSchemaOnlyDataChange,
	listChangedFiles,
	MODULES,
	type ModuleKey,
	main,
} from "./determine-changes.ts";
import {
	DOCSTRING_PYTHON,
	isPublishDocstringOnlyChange,
	PUBLISH_SOURCE_PATH,
} from "./publish-docstring.mts";

const changed = (files: string[], ...keys: ModuleKey[]) =>
	keys.map((key) => detectChanges(files)[key]);

describe("detectChanges", () => {

	describe("documentation preserves every migration routing decision", () => {
		for (const migrations of [
			["data/mysql/tanah_daily_bulletin_upgrade.sql"],
			["data/mysql/tanah_daily_bulletin_whatsapp_upgrade.sql"],
			[
				"data/mysql/tanah_daily_bulletin_upgrade.sql",
				"data/mysql/tanah_daily_bulletin_whatsapp_upgrade.sql",
			],
		]) {
			test(migrations.join(" + "), () => {
				const files = ["data/annotations/GOLDEN.md", ...migrations];
				assert.deepEqual(detectChanges(files).data, {
					module_changed: true,
					ci_changed: true,
				});
				assert.equal(
					isSchemaOnlyDataChange(files),
					isSchemaOnlyDataChange(migrations),
				);
				assert.equal(isDataDeployChange(files), false);
			});
		}
	});
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
		// Standalone report inspection never ships in the website.
		"web/bible-on-site/scripts/coverage-gaps.mjs",
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

	test("pending API release tooling selects API checks without unrelated delivery", () => {
		for (const file of [
			"devops/github/ci/pending-api-release.mjs",
			"devops/github/ci/pending-api-release.test.mjs",
		]) {
			const changes = detectChanges([file]);
			for (const [key, flags] of Object.entries(changes)) {
				assert.deepEqual(flags, { module_changed: false, ci_changed: key === "api" }, `${file} -> ${key}`);
			}
			assert.equal(isDataDeployChange([file]), false, file);
		}
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
			"WhatsApp upgrade and bootstrap preservation stay manual",
			[
				"data/mysql/tanah_daily_bulletin_whatsapp_upgrade.sql",
				"data/mysql/db-populator/src/main.rs",
				"devops/deploy/data-deploy/sql-files.json",
				"web/admin/src/server/whatsapp-delivery.server.ts",
			],
			true,
		],
		[
			"WhatsApp upgrade alone stays manual",
			["data/mysql/tanah_daily_bulletin_whatsapp_upgrade.sql"],
			true,
		],
		[
			"WhatsApp upgrade cannot hide content changes",
			[
				"data/mysql/tanah_daily_bulletin_whatsapp_upgrade.sql",
				"data/mysql/db-populator/src/main.rs",
				"data/mysql/tanah_dedication_data.sql",
			],
			false,
		],
		[
			"Telegram upgrade alone stays manual",
			["data/mysql/tanah_daily_bulletin_telegram_upgrade.sql"],
			true,
		],
		[
			"Telegram upgrade with preservation fixture stays manual",
			[
				"data/mysql/tanah_daily_bulletin_telegram_upgrade.sql",
				"data/mysql/db-populator/src/main.rs",
				"web/admin/src/server/telegram-delivery.server.ts",
			],
			true,
		],
		[
			"all bulletin migrations with preservation fixture stay manual",
			[
				"data/mysql/tanah_daily_bulletin_upgrade.sql",
				"data/mysql/tanah_daily_bulletin_telegram_upgrade.sql",
				"data/mysql/tanah_daily_bulletin_whatsapp_upgrade.sql",
				"data/mysql/db-populator/src/main.rs",
			],
			true,
		],
		[
			"Telegram upgrade cannot hide a full content rebuild",
			[
				"data/mysql/tanah_daily_bulletin_telegram_upgrade.sql",
				"data/mysql/db-populator/src/main.rs",
				"data/mysql/tanah_static_structure.sql",
			],
			false,
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

test("bulletin infrastructure changes select data checks without releasing content", () => {
	for (const file of [
		"docs/aws/cloudformation/daily-bulletin-ses.yaml",
		"docs/aws/cloudformation/daily-bulletin-whatsapp.yaml",
		"docs/aws/cloudformation/daily-bulletin-telegram.yaml",
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
	 * Queue runs keep master at root and put both entries on the queue branch.
	 */
	function run(
		eventName: string,
		event: (shas: {
			root: string;
			replaced: string;
			base: string;
			head: string;
		}) => object,
		changedPath = "web/bible-on-site/src/page.tsx",
		changeKind: "write" | "delete" = "write",
		ancestorPath = "web/api/src/main.rs",
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
			if (eventName === "merge_group") {
				git(work, "checkout", "--quiet", "-b", "gh-readonly-queue/master/tail");
			}
			const base = commit(work, ancestorPath);
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
			const head = git(work, "rev-parse", "HEAD");
			if (eventName === "merge_group") {
				assert.equal(git(work, "rev-parse", "master"), root);
				assert.equal(git(work, "rev-parse", "HEAD^"), base);
				assert.equal(git(work, "diff", "--name-only", base, head), changedPath);
				assert.deepEqual(
					git(work, "diff", "--name-only", root, head).split("\n"),
					[ancestorPath, changedPath].sort(),
				);
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
			writeFileSync(
				eventPath,
				JSON.stringify(event({ root, replaced, base, head })),
			);
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

	test("HEADGREEN tail validates the app entry ahead of a breadcrumb-only entry", () => {
		// #2797 -> #2804: payload base d56ae2f already contained the app entry,
		// while head 45b8990 added only the breadcrumb fix. That delta cannot
		// authorize skipping app checks for the combined tail HEADGREEN validates.
		const { changes, output } = run(
			"merge_group",
			({ base, head }) => ({
				action: "checks_requested",
				merge_group: {
					base_sha: base,
					head_sha: head,
					base_ref: "refs/heads/master",
					head_ref: "refs/heads/gh-readonly-queue/master/tail",
				},
			}),
			"web/bible-on-site/src/app/components/BreadcrumbDropdown.tsx",
			"write",
			"app/BibleOnSite/AppShell.xaml.cs",
		);
		for (const [key, flags] of Object.entries(changes)) {
			assert.deepEqual(flags, { module_changed: false, ci_changed: true }, key);
		}
		assert.match(output, /^data_schema_only_changed=false$/m);
		assert.match(output, /^data_deploy_changed=false$/m);
	});

	for (const path of [
		"data/mysql/tanahpedia_alter_mention_decoration.sql",
		"devops/deploy/data-deploy/index.mts",
	]) {
		test(`merge_group validates without delivery intent for ${path}`, () => {
			const { changes, output } = run(
				"merge_group",
				({ base }) => ({ merge_group: { base_sha: base } }),
				path,
			);
			for (const flags of Object.values(changes)) {
				assert.deepEqual(flags, { module_changed: false, ci_changed: true });
			}
			assert.match(output, /^data_schema_only_changed=false$/m);
			assert.match(output, /^data_deploy_changed=false$/m);
		});
	}

	test("workflow_dispatch compares with master", () => {
		const { changes } = run("workflow_dispatch", () => ({}));
		for (const flags of Object.values(changes)) {
			assert.deepEqual(flags, { module_changed: false, ci_changed: false });
		}
	});
});

describe("merge-group workflow contract", () => {
	const ci = readFileSync(
		new URL("../../../.github/workflows/ci.yml", import.meta.url),
		"utf8",
	).replace(/\r/g, "");
	const job = (name: string) => {
		const section = ci.split(`\n  ${name}:\n`)[1];
		assert.ok(section, `Missing job ${name}`);
		return section.split(/\n {2}[a-z][a-z0-9_]*:\n/)[0];
	};
	const condition = (name: string) => {
		const value = job(name).match(/^ {4}if: (.+)$/m)?.[1];
		assert.ok(value, `Missing condition for ${name}`);
		return value;
	};

	test("routing regressions run before selection on every event without package dependencies", () => {
		const steps = job("determine_changes");
		const setup = steps.indexOf("uses: actions/setup-node@");
		const regression = steps.indexOf(
			"run: node --test devops/github/ci/determine-changes.test.ts",
		);
		const selection = steps.indexOf(
			"run: node devops/github/ci/determine-changes.ts",
		);
		assert.ok(setup >= 0 && regression > setup && selection > regression);
		const nextStep = steps.indexOf("\n      - ", selection);
		const routingSteps = steps.slice(0, nextStep < 0 ? steps.length : nextStep);
		assert.doesNotMatch(routingSteps, /^ {4}if:|^ {8}if:/m);
	});

	test("combined queue heads force full Playwright and mobile suites", () => {
		assert.ok(
			ci.includes(
				`FORCE_FULL_SUITE: \${{ github.event_name == 'merge_group' && 'true' || inputs.force_full_suite || vars.E2E_FORCE_FULL_SUITE || '' }}`,
			),
		);
		assert.ok(
			job("app_mobile_e2e").includes(
				`force_full_suite: \${{ github.event_name == 'merge_group' }}`,
			),
		);
	});

	test("a missing queue Mongo image is exported and loaded by both consumers without registry publication", () => {
		assert.ok(
			job("determine_docker_image_availability").includes(
				`can_publish_sefaria_mongo: \${{ github.event_name != 'merge_group' && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) }}`,
			),
		);
		const producer = job("build_sefaria_mongo_docker");
		assert.ok(
			producer.includes(
				"needs.determine_changes.outputs.data_ci_changed == 'true'",
			),
		);
		assert.ok(
			producer.includes(
				"can_publish_sefaria_mongo == 'true' && 'type=registry,compression=zstd,force-compression=true,oci-mediatypes=true' || 'type=docker,dest=/tmp/sefaria-mongo-image.tar'",
			),
		);
		assert.ok(producer.includes("can_publish_sefaria_mongo != 'true'"));
		assert.ok(
			producer.includes(`name: \${{ env.SEFARIA_MONGO_IMAGE_ARTIFACT_NAME }}`),
		);
		for (const name of ["data_ci", "perushim_data"]) {
			const consumer = job(name);
			assert.ok(consumer.includes("build_sefaria_mongo_docker"), name);
			assert.ok(
				consumer.includes(
					`outputs.is_sefaria_mongo_available }}" != "true" ] && [ "\${{ needs.determine_docker_image_availability.outputs.can_publish_sefaria_mongo }}" != "true"`,
				),
				name,
			);
			assert.ok(
				consumer.includes(
					`gh run download \${{ github.run_id }} -n \${{ env.SEFARIA_MONGO_IMAGE_ARTIFACT_NAME }}`,
				),
				name,
			);
			assert.ok(
				consumer.includes("docker load --input /tmp/sefaria-mongo-image.tar"),
				name,
			);
		}
	});

	test("queue perushim and native audio producers have matching required gates", () => {
		assert.ok(
			job("perushim_data").includes(
				"(github.event_name == 'merge_group' && needs.determine_changes.outputs.perushim_pipeline_ci_changed == 'true')",
			),
		);
		assert.ok(
			condition("app_ios_ci").includes(
				"(github.event_name == 'pull_request' || github.event_name == 'merge_group')",
			),
		);
		const prerequisites = job("cross_module_ci")
			.split("        run: |\n")[1]
			.split("\n      - name: Checkout")[0]
			.split("\n")
			.map((line) => line.slice(10))
			.join("\n");
		const bash =
			process.platform === "win32"
				? join(
						process.env.ProgramFiles ?? "C:\\Program Files",
						"Git",
						"bin",
						"bash.exe",
					)
				: "bash";
		const evaluate = (
			event: string,
			failedJob?: string,
			ciChanged = true,
			baselineAvailable = true,
			versions = { amd64: "0.1.96", arm64: "0.1.96" },
			prerequisiteSource = prerequisites,
		) => {
			const script = prerequisiteSource.replace(
				/\$\{\{ ([^}]+) \}\}/g,
				(_match, expression: string) => {
					if (expression === "github.event_name") return event;
					if (expression.endsWith(".result")) {
						return expression === `needs.${failedJob}.result`
							? "skipped"
							: "success";
					}
					if (expression === "needs.package_api.outputs.module_version")
						return versions.amd64;
					if (expression === "needs.package_api_arm64.outputs.module_version")
						return versions.arm64;
					if (expression.includes("_ci_changed")) return String(ciChanged);
					if (expression.includes("_module_changed")) return "false";
					if (expression.includes(".outputs.is_"))
						return String(baselineAvailable);
					throw new Error(`Unexpected prerequisite expression: ${expression}`);
				},
			);
			return spawnSync(bash, ["--noprofile", "--norc", "-e", "-s"], {
				input: script,
				encoding: "utf8",
			});
		};
		// Paired-image guards may arrive independently of the queue fixture.
		// Keep output substitution strict and exercise missing/mismatched versions.
		const versionGate = prerequisites + `
if [ -z "\${{ needs.package_api.outputs.module_version }}" ] ||
   [ "\${{ needs.package_api.outputs.module_version }}" != "\${{ needs.package_api_arm64.outputs.module_version }}" ]; then
  exit 1
fi
`;
		for (const [amd64, arm64] of [
			["0.1.96", "0.1.96"],
			["0.1.96", "0.1.95"],
			["", ""],
			["", "0.1.96"],
			["0.1.96", ""],
		] as const) {
			const result = evaluate("merge_group", undefined, true, true,
				{ amd64, arm64 }, versionGate);
			assert.ifError(result.error);
			assert.equal(result.status, amd64 !== "" && amd64 === arm64 ? 0 : 1,
				result.stdout + result.stderr);
		}
		assert.throws(
			() => evaluate("merge_group", undefined, true, true, undefined,
				prerequisites + "\n${{ needs.unknown.outputs.module_version }}"),
			/Unexpected prerequisite expression/,
		);
		const passing = evaluate("merge_group");
		assert.ifError(passing.error);
		assert.equal(passing.status, 0, passing.stdout + passing.stderr);
		for (const name of [
			"website_performance",
			"website_e2e",
			"api_e2e",
			"app_ci",
			"admin_ci",
			"bulletin_ci",
			"data_ci",
			"app_mobile_e2e",
			"app_ios_ci",
			"perushim_data",
			"package_ios_pr",
			"package_windows_pr",
			"package_api",
			"package_bulletin",
			"package_admin",
			"validate_website_architectures",
			"validate_api_architectures",
			"validate_admin_architectures",
			"recitation_ci",
			"deploy_verifier",
			"calendar_pdf_artifacts",
		]) {
			const result = evaluate("merge_group", name);
			assert.ifError(result.error);
			assert.notEqual(
				result.status,
				0,
				`${name} may not skip on a combined queue head`,
			);
		}
		// Baseline recovery alone never selects the PR native-audio producer.
		const recovery = evaluate("pull_request", "app_ios_ci", false, false);
		assert.ifError(recovery.error);
		assert.equal(recovery.status, 0, recovery.stdout + recovery.stderr);
		for (const event of ["push", "workflow_dispatch"]) {
			for (const name of ["app_ios_ci", "perushim_data"]) {
				const result = evaluate(event, name);
				assert.ifError(result.error);
				assert.equal(
					result.status,
					0,
					`${event}/${name}: ${result.stdout}${result.stderr}`,
				);
			}
		}
	});

	test("queue validation cannot run production website packaging or release jobs", () => {
		for (const name of [
			"package_website",
			"release_website",
			"release_api",
			"release_app",
			"release_admin",
			"release_bulletin",
			"release_data",
		]) {
			assert.ok(condition(name).includes("github.event_name == 'push'"), name);
			assert.ok(
				condition(name).includes(
					"needs.setup_env.outputs.is_master_branch == 'true'",
				),
				name,
			);
		}
		assert.ok(
			ci.includes(
				`IS_MASTER_BRANCH: \${{ github.ref == format('refs/heads/{0}', github.event.repository.default_branch) }}`,
			),
		);
	});
});

const publisherSource = readFileSync(
	new URL("../../../data/annotations/publish.py", import.meta.url),
	"utf8",
).replace(
	"node devops/export-tanahpedia-articles.mts",
	"node --import tsx devops/export-tanahpedia-articles.mts",
);
const correctedPublisher = publisherSource.replace(
	"node --import tsx devops/export-tanahpedia-articles.mts",
	"node devops/export-tanahpedia-articles.mts",
);
const publisherDocEnd = publisherSource.indexOf('\n"""') + 4;
assert.ok(publisherDocEnd > 3);
const publisherBody = publisherSource.slice(publisherDocEnd);

function astDocProof(before: string, after: string): boolean {
	const result = execFileSync(
		DOCSTRING_PYTHON,
		[
			"-I",
			"-S",
			fileURLToPath(new URL("./publish-docstring-proof.py", import.meta.url)),
		],
		{
			input: JSON.stringify({
				base: Buffer.from(before).toString("base64"),
				head: Buffer.from(after).toString("base64"),
			}),
			encoding: "utf8",
		},
	);
	return result.trim() === "true";
}

describe("publisher docstring AST proof", () => {
	test("actual publisher help documents commands from the repository root", () => {
		const root = fileURLToPath(new URL("../../../", import.meta.url));
		const help = execFileSync(
			DOCSTRING_PYTHON,
			[
				fileURLToPath(
					new URL("../../../data/annotations/publish.py", import.meta.url),
				),
				"--help",
			],
			{ cwd: root, encoding: "utf8" },
		);
		assert.match(help, /Gated production run from the repository root/);
		assert.match(help, /node devops\/export-tanahpedia-articles\.mts/);
		assert.match(help, /python data\/annotations\/publish\.py --pasuk-out/);
		assert.doesNotMatch(help, /--import tsx|python publish\.py/);
	});

	test("requires the real standard-library interpreter used by CI", () => {
		assert.match(
			execFileSync(DOCSTRING_PYTHON, ["-I", "-S", "--version"], {
				encoding: "utf8",
			}),
			/Python 3\./,
		);
	});
	for (const [label, doc] of [
		[
			"native Node command",
			correctedPublisher.slice(0, correctedPublisher.indexOf('\n"""') + 4),
		],
		["UTF8 columns", '"""תיעוד יצוא ללא שינוי בקוד"""'],
		[
			"CRLF docstring",
			publisherSource.slice(0, publisherDocEnd).split("\n").join("\r\n"),
		],
		[
			"escaped delimiter",
			String.raw`"""Text with an escaped delimiter \""" remains documentation.
"""`,
		],
		["implicit literal concatenation", '"""First part""" """second part"""'],
	]) {
		test("accepts only the leading documentation change: " + label, () => {
			assert.equal(astDocProof(publisherSource, doc + publisherBody), true);
		});
	}
	for (const [label, source] of [
		["missing docstring", publisherBody],
		["unterminated docstring", '"""not closed'],
		["computed expression", '"""one""" + """two"""' + publisherBody],
		["f-string expression", 'f"""not a module docstring"""' + publisherBody],
		["bytes expression", 'b"""not text"""' + publisherBody],
		["invalid Python", correctedPublisher + "\nif (\n"],
		[
			"body code",
			correctedPublisher +
				"\nraise RuntimeError('must never execute source')\n",
		],
		[
			"body comment",
			correctedPublisher +
				"\n# Source outside the module docstring stays delivery-affecting.\n",
		],
	]) {
		test("retains delivery for " + label, () =>
			assert.equal(astDocProof(publisherSource, source), false),
		);
	}
	test("requires the audited body even when both revisions share a new __doc__ consumer", () => {
		const consumption = "\nPAYLOAD = __doc__\n";
		assert.equal(
			astDocProof(
				publisherSource + consumption,
				correctedPublisher + consumption,
			),
			false,
		);
	});
	test("preserves all source bytes outside the docstring, including line endings", () => {
		assert.equal(
			astDocProof(publisherSource, correctedPublisher.split("\n").join("\r\n")),
			false,
		);
	});
});

function publisherFixture(
	t: TestContext,
	{
		before = publisherSource,
		after = correctedPublisher,
		extra = [],
		modeChange = false,
		shallow = true,
	}: {
		before?: string | null;
		after?: string | null;
		extra?: string[];
		modeChange?: boolean;
		shallow?: boolean;
	} = {},
) {
	const root = mkdtempSync(join(tmpdir(), "publisher-routing-"));
	t.after(() => {
		assert.equal(dirname(root), tmpdir());
		rmSync(root, { recursive: true, force: true });
	});
	const work = join(root, "work"),
		origin = join(root, "origin.git"),
		clone = join(root, "clone");
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	const write = (path: string, body: string) => {
		mkdirSync(dirname(join(work, path)), { recursive: true });
		writeFileSync(join(work, path), body);
	};
	mkdirSync(work);
	git(work, "init", "--quiet", "--initial-branch=master");
	git(work, "config", "user.name", "CI fixture");
	git(work, "config", "user.email", "ci-fixture@example.invalid");
	git(work, "config", "core.autocrlf", "false");
	write("README.md", "initial history\n");
	git(work, "add", ".");
	git(work, "commit", "--quiet", "-m", "Root history");
	write("README.md", "source-proof fixture\n");
	if (before !== null) write(PUBLISH_SOURCE_PATH, before);
	git(work, "add", ".");
	git(work, "commit", "--quiet", "-m", "Base source");
	const baseSha = git(work, "rev-parse", "HEAD");
	if (after === null) rmSync(join(work, PUBLISH_SOURCE_PATH));
	else write(PUBLISH_SOURCE_PATH, after);
	for (const path of extra) write(path, "changed input\n");
	git(work, "add", ".");
	if (modeChange) git(work, "update-index", "--chmod=+x", PUBLISH_SOURCE_PATH);
	git(work, "commit", "--quiet", "--allow-empty", "-m", "Head source");
	const headSha = git(work, "rev-parse", "HEAD");
	git(root, "clone", "--quiet", "--no-local", "--bare", work, origin);
	git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
	git(
		root,
		"clone",
		"--quiet",
		...(shallow ? ["--depth=1"] : []),
		`file://${origin.split("\\").join("/")}`,
		clone,
	);
	return {
		root,
		clone,
		baseSha,
		headSha,
		git: (...args: string[]) => git(clone, ...args),
		run: () => {
			const eventPath = join(root, "event.json"),
				outputPath = join(root, "output.txt");
			writeFileSync(eventPath, JSON.stringify({ before: baseSha }));
			const changes = main(
				{
					GITHUB_EVENT_NAME: "push",
					GITHUB_EVENT_PATH: eventPath,
					GITHUB_OUTPUT: outputPath,
				},
				clone,
			);
			return { changes, output: readFileSync(outputPath, "utf8") };
		},
	};
}

describe("publisher docstring release routing", () => {
	test("uses immutable base/head blobs in a shallow checkout and selects checks only", (t) => {
		const fixture = publisherFixture(t);
		assert.equal(fixture.git("rev-parse", "--is-shallow-repository"), "true");
		// Uncommitted code is deliberately unrelated: proof must use the tested Git blobs.
		writeFileSync(
			join(fixture.clone, PUBLISH_SOURCE_PATH),
			"raise RuntimeError('working tree is not the source')\n",
		);
		const { changes, output } = fixture.run();
		assert.deepEqual(changes.data, { module_changed: false, ci_changed: true });
		assert.match(output, /^data_module_changed=false$/m);
		assert.match(output, /^data_ci_changed=true$/m);
		assert.match(output, /^data_deploy_changed=false$/m);
		assert.match(output, /^data_schema_only_changed=false$/m);
		assert.equal(fixture.git("rev-parse", "--is-shallow-repository"), "true");
	});
	for (const [label, options] of [
		["deleted source", { after: null }],
		["new source", { before: null }],
		["file mode change", { modeChange: true }],
		["changed implementation", { after: correctedPublisher + "\nVALUE = 1\n" }],
		[
			"ambiguous expression",
			{ after: '"""one""" + """two"""' + publisherBody },
		],
	] as const) {
		test("keeps normal delivery for " + label, (t) => {
			const fixture = publisherFixture(t, options);
			assert.equal(
				isPublishDocstringOnlyChange({ ...fixture, cwd: fixture.clone }),
				false,
			);
			assert.deepEqual(fixture.run().changes.data, {
				module_changed: true,
				ci_changed: false,
			});
		});
	}
	test("missing interpreter or unreadable immutable blob cannot prove a safe exclusion", (t) => {
		const fixture = publisherFixture(t);
		assert.equal(
			isPublishDocstringOnlyChange({
				...fixture,
				cwd: fixture.clone,
				python: join(fixture.root, "missing-python"),
			}),
			false,
		);
		assert.equal(
			isPublishDocstringOnlyChange({
				...fixture,
				cwd: fixture.clone,
				baseSha: "0".repeat(40),
			}),
			false,
		);
	});
	for (const [label, extra, schemaOnly, pipeline] of [
		[
			"manual migration",
			"data/mysql/tanahpedia_alter_mention_decoration.sql",
			true,
			false,
		],
		[
			"real SQL payload",
			"data/mysql/tanah_sefarim_and_perakim_data.sql",
			false,
			false,
		],
		[
			"real pipeline source",
			"data/sefaria/pipelines/perushim-view/src/main.rs",
			false,
			true,
		],
	] as const) {
		test("preserves " + label + " alongside a proven docstring change", (t) => {
			const fixture = publisherFixture(t, { extra: [extra] });
			const { changes, output } = fixture.run();
			assert.deepEqual(changes.data, {
				module_changed: true,
				ci_changed: true,
			});
			assert.equal(changes.perushim_pipeline.module_changed, pipeline);
			assert.ok(
				output
					.split(/\r?\n/)
					.includes(`data_schema_only_changed=${schemaOnly}`),
			);
		});
	}
	test("helper and regression edits select the required data checks without delivery", () => {
		for (const file of [
			"devops/github/ci/publish-docstring.mts",
			"devops/github/ci/publish-docstring-proof.py",
			"devops/github/ci/determine-changes.test.ts",
		]) {
			assert.deepEqual(
				detectChanges([file]).data,
				{ module_changed: false, ci_changed: true },
				file,
			);
			assert.equal(isDataDeployChange([file]), false);
		}
	});
});

describe("existing full Git history", () => {
	for (const kind of ["sha", "parent", "branch"] as const) {
		test("stays full when resolving " + kind + " event bases", (t) => {
			const fixture = publisherFixture(t, { shallow: false });
			const count = fixture.git("rev-list", "--count", "HEAD");
			assert.equal(
				fixture.git("rev-parse", "--is-shallow-repository"),
				"false",
			);
			const base =
				kind === "sha"
					? { kind, sha: fixture.baseSha }
					: kind === "branch"
						? { kind, branch: "master" }
						: { kind };
			listChangedFiles(base, fixture.clone);
			assert.equal(
				fixture.git("rev-parse", "--is-shallow-repository"),
				"false",
			);
			assert.equal(fixture.git("rev-list", "--count", "HEAD"), count);
		});
	}
});
