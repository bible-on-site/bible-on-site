#!/usr/bin/env node
/**
 * Installs the repository's git hooks (pre-commit + post-commit stages). Runs
 * from the root package.json `prepare` script — which fires on `pnpm install`/
 * `pnpm install --frozen-lockfile` — and from devops/setup-dev-env.mts.
 *
 * Prefers prek (the repo's hook runner — parallel execution, Rust fast paths)
 * from the devops venv so the installed hook keeps working without activating
 * the venv; falls back to prek on PATH, then to pre-commit for clones that
 * have not re-run setup yet. Exits 0 with a notice when either git or a hook
 * runner is unavailable (e.g. pnpm install --frozen-lockfile in a Docker layer): hook installation is
 * a local-dev convenience, never a build blocker.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isWin = process.platform === "win32";
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
	cwd: projectDir,
	encoding: "utf8",
});
if (inside.status !== 0 || inside.stdout.trim() !== "true") {
	console.info("[install-git-hooks] not a git worktree — skipping.");
	process.exit(0);
}

// Husky used to own git hooks via core.hooksPath=.husky/_; if a clone still
// points there, detach it so the hooks installed below are the ones that run.
const hooksPath = spawnSync("git", ["config", "--get", "core.hooksPath"], {
	cwd: projectDir,
	encoding: "utf8",
}).stdout?.trim();
if (hooksPath?.includes(".husky")) {
	spawnSync("git", ["config", "--unset", "core.hooksPath"], {
		cwd: projectDir,
	});
	console.info(
		`[install-git-hooks] removed Husky core.hooksPath (${hooksPath}).`,
	);
}

const venvBin = join(
	projectDir,
	"devops",
	".venv",
	isWin ? "Scripts" : "bin",
);
const candidates = [
	join(venvBin, isWin ? "prek.exe" : "prek"),
	"prek",
	join(venvBin, isWin ? "pre-commit.exe" : "pre-commit"),
	"pre-commit",
];
// Bare names resolve through PATH; absolute candidates exist as real files.
// git, prek and pre-commit all resolve to real .exe files on Windows — no shell.
const isBareName = (candidate) => !candidate.includes("/") && !candidate.includes("\\");
const runner = candidates.find((candidate) =>
	isBareName(candidate)
		? spawnSync(candidate, ["--version"]).status === 0
		: existsSync(candidate),
);
if (!runner) {
	console.info(
		"[install-git-hooks] neither prek nor pre-commit found — skipping " +
			"(run `pnpm -C devops run setup_dev_env` to enable git hooks).",
	);
	process.exit(0);
}

const result = spawnSync(
	runner,
	["install", "--hook-type", "pre-commit", "--hook-type", "post-commit"],
	{ cwd: projectDir, stdio: "inherit" },
);
process.exit(result.status ?? 1);
