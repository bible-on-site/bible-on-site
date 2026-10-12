#!/usr/bin/env node
/**
 * Installs the repository's pre-commit git hooks (pre-commit + post-commit
 * stages). Runs from the root package.json `prepare` script — which fires on
 * `npm install`/`npm ci` — and from devops/setup-dev-env.mts.
 *
 * Prefers the devops venv's pre-commit so the installed hook keeps working
 * without activating the venv; falls back to a pre-commit on PATH. Exits 0
 * with a notice when either git or pre-commit is unavailable (e.g. npm ci in
 * a Docker layer): hook installation is a local-dev convenience, never a
 * build blocker.
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

const candidates = [
	join(
		projectDir,
		"devops",
		".venv",
		isWin ? "Scripts" : "bin",
		isWin ? "pre-commit.exe" : "pre-commit",
	),
	"pre-commit",
];
// git and pre-commit resolve to real .exe files on every platform — no shell.
const preCommit = candidates.find((candidate) =>
	candidate === "pre-commit"
		? spawnSync("pre-commit", ["--version"]).status === 0
		: existsSync(candidate),
);
if (!preCommit) {
	console.info(
		"[install-git-hooks] pre-commit not found — skipping " +
			"(run `npm run setup_dev_env --prefix devops` to enable git hooks).",
	);
	process.exit(0);
}

const result = spawnSync(
	preCommit,
	["install", "--hook-type", "pre-commit", "--hook-type", "post-commit"],
	{ cwd: projectDir, stdio: "inherit" },
);
process.exit(result.status ?? 1);
