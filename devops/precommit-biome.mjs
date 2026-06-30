#!/usr/bin/env node
/**
 * Pre-commit wrapper that runs each module's Biome linter on its staged files.
 *
 * Why a wrapper: every web module ships its own *root* biome.json
 * (web/bible-on-site, web/admin) and they may pin different Biome versions, so
 * Biome cannot be run once from the repo root ("Found a nested root
 * configuration, but there's already a root configuration"). We bucket the
 * staged paths by module, then run *that module's own* locally-installed Biome
 * from inside the module on the module-relative paths — exactly how CI lints
 * each module, and with the version the module actually pins. This is fully
 * cross-platform (no shell heredocs), unlike semgrep which has no native
 * Windows support.
 *
 * This is a local convenience gate (see `ci.skip` in .pre-commit-config.yaml):
 * the authoritative remote check is each module's CI lint job. If a module's
 * Biome is not installed (developer hasn't run `npm ci` there), we print a
 * notice and skip that module rather than blocking the commit.
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
	if (!existsSync(localBin)) {
		console.warn(
			`[biome-lint] skipping ${dir}: Biome not installed (run \`npm ci\` in ${dir}).`,
		);
		continue;
	}

	const result = spawnSync(localBin, ["lint", ...moduleFiles], {
		cwd: resolve(dir),
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
