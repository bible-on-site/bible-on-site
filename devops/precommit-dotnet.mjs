#!/usr/bin/env node
/**
 * Pre-commit C# analyzer gate: builds each touched app/ project so the
 * SonarAnalyzer.CSharp rules wired in .editorconfig (app/Directory.Build.props)
 * fail locally instead of first surfacing as post-push Codacy/Qodana
 * annotations — the #2114 enforcement half. Buckets staged changes by project
 * like precommit-rust.mjs does for cargo-make.
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

// Analyzer/shape config changes affect every project, so build them all.
const GLOBAL_TRIGGERS = [
	".editorconfig",
	"global.json",
	"app/Directory.Build.props",
];

const hasDotnet =
	spawnSync("dotnet", ["--version"], { stdio: "ignore" }).status === 0;
if (!hasDotnet) console.info("Skipping dotnet checks — dotnet SDK not installed.");

const stagedFiles = getStagedChanges();
const buildAll = GLOBAL_TRIGGERS.some((f) => stagedFiles.includes(f));

let failed = false;
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

process.exit(failed ? 1 : 0);
