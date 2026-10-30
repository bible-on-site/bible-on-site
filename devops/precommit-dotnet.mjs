#!/usr/bin/env node
/**
 * Pre-commit C# gates: builds each touched app/ project so the
 * SonarAnalyzer.CSharp rules wired in .editorconfig (app/Directory.Build.props)
 * fail locally instead of first surfacing as post-push Codacy/Qodana
 * annotations — the #2114 enforcement half. Buckets staged changes by project
 * like precommit-rust.mjs does for cargo-make.
 * `--tests` switches to unit-test mode: `dotnet test` on the test projects
 * whose product dirs changed (#1229).
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { getStagedChanges, runIn } from "./precommit-changes.mjs";

// The MAUI app is multi-TFM; build only the TFM this platform actually carries.
const APP_TFM =
	process.platform === "win32"
		? "net10.0-windows10.0.19041.0"
		: process.platform === "darwin"
			? "net10.0-maccatalyst"
			: "net10.0-android";

/**
 * Project dir → build args (after `dotnet build`, run from repo root).
 * Ordered: longest dir prefix wins when one dir contains another.
 */
const PROJECTS = {
	"app/BibleOnSite.Tests.MobileE2E": ["app/BibleOnSite.Tests.MobileE2E/BibleOnSite.Tests.MobileE2E.csproj"],
	"app/BibleOnSite.Tests.E2E": ["app/BibleOnSite.Tests.E2E/BibleOnSite.Tests.E2E.csproj"],
	"app/BibleOnSite.E2eCoverage": ["app/BibleOnSite.E2eCoverage/BibleOnSite.E2eCoverage.csproj"],
	"app/BibleOnSite.Tests": ["app/BibleOnSite.Tests/BibleOnSite.Tests.csproj"],
	"app/BibleOnSite": ["app/BibleOnSite/BibleOnSite.csproj", "-f", APP_TFM],
	"app/devops.Tests": ["app/devops.Tests/devops.Tests.csproj"],
	"app/devops": ["app/devops/_build.csproj"],
};

/**
 * --tests mode: test project → sources that should run it. A test project
 * runs when its own dir OR the product it covers changed — a source-only
 * staged set still exercises the tests that gate it in CI (#1229).
 * e2e/coverage projects are intentionally absent: they need emulators,
 * servers and services a pre-commit cannot carry.
 */
const TEST_PROJECTS = {
	"app/BibleOnSite.Tests": {
		project: "app/BibleOnSite.Tests/BibleOnSite.Tests.csproj",
		sources: ["app/BibleOnSite.Tests/", "app/BibleOnSite/"],
	},
	"app/devops.Tests": {
		project: "app/devops.Tests/devops.Tests.csproj",
		sources: ["app/devops.Tests/", "app/devops/"],
	},
};

// Analyzer/shape config changes affect every project, so build them all.
const GLOBAL_TRIGGERS = [
	".editorconfig",
	"global.json",
	"app/Directory.Build.props",
];

const runTests = process.argv.includes("--tests");

const hasDotnet =
	spawnSync("dotnet", ["--version"], { stdio: "ignore" }).status === 0;
if (!hasDotnet) console.info("Skipping dotnet checks — dotnet SDK not installed.");

const stagedFiles = getStagedChanges();
const buildAll = GLOBAL_TRIGGERS.some((f) => stagedFiles.includes(f));

let failed = false;
if (runTests) {
	for (const [dir, { project, sources }] of Object.entries(TEST_PROJECTS)) {
		const touched =
			buildAll ||
			stagedFiles.some((file) =>
				sources.some((source) => file.startsWith(source)),
			);
		if (!touched) continue;
		// Same offline-safe gate as the build mode: restored assets only.
		if (!hasDotnet || !existsSync(join(dir, "obj", "project.assets.json"))) {
			if (hasDotnet)
				console.info(`Skipping ${dir} — project not restored/built yet.`);
			continue;
		}
		// Mirrors the TestUnit nuke task: Microsoft.Testing.Platform args go
		// after `--`; non-integration categories only, same as CI.
		const args = [
			"dotnet",
			"test",
			project,
			"--no-restore",
			"--nologo",
			"-v",
			"q",
			"--",
			"--filter-not-trait",
			"Category=Integration",
		];
		console.info(`Detected changes in ${dir} — running: ${args.join(" ")}`);
		if (runIn(".", args) !== 0) failed = true;
	}
} else {
	for (const [dir, args] of Object.entries(PROJECTS)) {
		const touched =
			buildAll || stagedFiles.some((file) => file.startsWith(`${dir}/`));
		if (!touched) continue;
		// Without prior restored assets a build would need a package-feed fetch —
		// not possible in sandboxed runs (pre-commit.ci) and slow on fresh clones.
		// --no-restore keeps the gate offline-safe once assets exist.
		if (!hasDotnet || !existsSync(join(dir, "obj", "project.assets.json"))) {
			if (hasDotnet)
				console.info(`Skipping ${dir} — project not restored/built yet.`);
			continue;
		}
		console.info(`Detected changes in ${dir} — running: dotnet build ${args.join(" ")}`);
		if (runIn(".", ["dotnet", "build", ...args, "--no-restore", "--nologo", "-v", "q"]) !== 0)
			failed = true;
	}
}

process.exit(failed ? 1 : 0);
