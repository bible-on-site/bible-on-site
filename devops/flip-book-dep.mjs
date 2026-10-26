#!/usr/bin/env node
/**
 * Keeps html-flip-book-react pinned to the published npm version in commits
 * while letting developers use their local checkout during development.
 *
 *  - `pre`:  if the dependency resolves to the local file: build, switch it to
 *    the npm version, stage package.json + bun.lock, and leave a
 *    marker file.
 *  - `post`: if the marker exists, restore the local dependency.
 *
 * Replaces web/bible-on-site/.husky/{pre-commit,post-commit} — invoked by the
 * flip-book-npm-dep (pre-commit) and flip-book-local-restore (post-commit)
 * pre-commit hooks.
 *
 * usage: node devops/flip-book-dep.mjs <pre|post>
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const isWin = process.platform === "win32";
const websiteDir = resolve("web/bible-on-site");
const markerFile = resolve(websiteDir, ".flip-book-was-local");

function bunRun(script, stdio = "inherit") {
	// shell is required only on Windows to spawn bun's .cmd shim;
	// argv is fully static — no user input is shelled.
	return spawnSync("bun", ["run", script], { // nosemgrep
		cwd: websiteDir,
		shell: isWin,
		stdio,
	});
}

if (process.argv[2] === "post") {
	// Restore local flip-book only if the pre-commit hook switched it to npm.
	if (!existsSync(markerFile)) process.exit(0);
	rmSync(markerFile);
	process.exit(bunRun("flip-book:local").status ?? 1);
}

rmSync(markerFile, { force: true });
// The check only reads package.json — spawn it directly so it works where
// bun/node_modules are absent (e.g. pre-commit.ci clones); a `bun run`
// failure there would otherwise masquerade as a local dependency.
const check = spawnSync(
	process.execPath,
	["scripts/toggle-flip-book-dep.mjs", "check"],
	{ cwd: websiteDir, stdio: ["ignore", "inherit", "ignore"] },
);
if (check.status !== 0) {
	console.info(
		"Auto-fixing: switching html-flip-book-react from local to npm...",
	);
	writeFileSync(markerFile, "");
	if (bunRun("flip-book:npm").status !== 0) process.exit(1);
	const add = spawnSync("git", ["add", "package.json", "bun.lock"], {
		cwd: websiteDir,
		stdio: "inherit",
	});
	if (add.status !== 0) process.exit(1);
}
