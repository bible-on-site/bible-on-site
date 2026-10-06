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
import { resolve } from "node:path";

/** Modules that have their own biome.json, in lint order. */
const MODULES = ["web/bible-on-site", "web/admin"];

const stagedFiles = process.argv.slice(2).map((f) => f.replaceAll("\\", "/"));

let failed = false;

for (const dir of MODULES) {
	const prefix = `${dir}/`;
	const moduleFiles = stagedFiles
		.filter((file) => file.startsWith(prefix))
		.map((file) => file.slice(prefix.length));
	if (moduleFiles.length === 0) continue;

	const localBin = resolve(
		dir,
		"node_modules",
		".bin",
		process.platform === "win32" ? "biome.cmd" : "biome",
	);
	// Prefer the module's pinned Biome; fall back to the hook env's binary.
	const biome = existsSync(localBin) ? localBin : "biome";

	// shell is required only on Windows to spawn the .cmd biome shim;
	// argv is fully static — no user input is shelled. The binary must be
	// quoted there because shell:true joins command+args into a raw cmd
	// line and a space in the checkout path (e.g. "devin workspace") would
	// otherwise split it into a bogus command.
	const result = spawnSync(
		process.platform === "win32" ? `"${biome}"` : biome,
		["lint", ...moduleFiles],
		{ // nosemgrep
			cwd: resolve(dir),
			stdio: "inherit",
			shell: process.platform === "win32",
		},
	);
	if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
