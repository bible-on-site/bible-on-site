#!/usr/bin/env node
/**
 * Pre-commit wrapper that runs each module's Biome linter on its staged files.
 *
 * Why a wrapper: every web module ships its own *root* biome.json
 * (web/bible-on-site, web/admin) and they may pin different Biome versions, so
 * Biome cannot be run once from the repo root ("Found a nested root
 * configuration, but there's already a root configuration"). We bucket the
 * staged paths by module, then run Biome from inside the module on the
 * module-relative paths — exactly how CI lints each module. This is fully
 * cross-platform (no shell heredocs), unlike semgrep which has no native
 * Windows support.
 *
 * Each run prefers the module's own locally-installed Biome (the version that
 * module pins). When the module isn't npm-installed — e.g. pre-commit.ci — it
 * falls back to the Biome that the hook's `additional_dependencies` install
 * into the hook environment (synced by sync-pre-commit-deps).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Modules that have their own biome.json, in lint order. */
const MODULES = ["web/bible-on-site", "web/admin"];

/**
 * Locate the hook-env Biome's JavaScript bin (installed by
 * additional_dependencies) on Windows without a shell: the env's biome.cmd
 * would otherwise force cmd.exe, letting staged filenames be re-parsed as
 * shell syntax. Global npm layout puts the package beside the .cmd shim at
 * <env>/node_modules/@biomejs/biome/bin/biome.
 */
function envBiomeJs() {
	if (process.platform !== "win32") return null;
	for (const dir of (process.env.PATH ?? "").split(";").filter(Boolean)) {
		const js = join(dir, "node_modules", "@biomejs", "biome", "bin", "biome");
		if (existsSync(join(dir, "biome.cmd")) && existsSync(js)) return js;
	}
	return null;
}

const stagedFiles = process.argv.slice(2).map((f) => f.replaceAll("\\", "/"));

let failed = false;

for (const dir of MODULES) {
	const prefix = `${dir}/`;
	const moduleFiles = stagedFiles
		.filter((file) => file.startsWith(prefix))
		.map((file) => file.slice(prefix.length));
	if (moduleFiles.length === 0) continue;

	// Prefer the module's pinned Biome through its JavaScript bin, which Node
	// runs directly — no .cmd shim, no shell. This keeps staged filenames as
	// literal argv entries so metacharacters can never reach cmd.exe, and
	// checkout paths with spaces need no quoting.
	const localBin = resolve(dir, "node_modules", "@biomejs", "biome", "bin", "biome");
	const envBin = envBiomeJs();
	const result = existsSync(localBin)
		? spawnSync( // nosemgrep
				process.execPath,
				[localBin, "lint", ...moduleFiles],
				{ cwd: resolve(dir), stdio: "inherit" },
			)
		: envBin
			? spawnSync( // nosemgrep
					process.execPath,
					[envBin, "lint", ...moduleFiles],
					{ cwd: resolve(dir), stdio: "inherit" },
				)
			: spawnSync( // nosemgrep — POSIX hook env exposes a shebang bin
					"biome",
					["lint", ...moduleFiles],
					{ cwd: resolve(dir), stdio: "inherit" },
				);
	if (result.error) {
		console.error(`biome-lint: could not run Biome for ${dir}: ${result.error.message}`);
	}
	if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
