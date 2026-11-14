#!/usr/bin/env node
/**
 * Pre-commit Rust checks: runs each touched Rust module's cargo-make lint
 * tasks. Buckets staged changes by module like precommit-biome.mjs does for
 * Biome — one hook covers all Rust modules.
 * `--tests` switches to unit-test mode: `cargo make test-unit` on the
 * modules that define it (#1229). data has no test-unit task, so it stays
 * lint-only either way.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { getStagedChanges, runIn } from "./precommit-changes.mjs";

/** Module dir → cargo-make tasks, in order. */
const MODULES = {
	"web/api": [["cargo", "make", "lint"]],
	"web/bulletin": [
		["cargo", "make", "lint"],
		["cargo", "make", "fmt-check"],
	],
	data: [
		["cargo", "make", "lint"],
		["cargo", "make", "fmt-check"],
	],
};

/** --tests mode: module dir → unit-test tasks (plain `cargo test`, no DB). */
const TEST_MODULES = {
	"web/api": [["cargo", "make", "test-unit"]],
	"web/bulletin": [["cargo", "make", "test-unit"]],
};

const runTests = process.argv.includes("--tests");
const modules = runTests ? TEST_MODULES : MODULES;

// cargo resolves to a real .exe on every platform — no shell needed.
const hasCargoMake =
	spawnSync("cargo", ["make", "--version"], { stdio: "ignore" }).status === 0;
if (!hasCargoMake)
	console.info("Skipping rust checks — cargo-make not installed.");

const stagedFiles = getStagedChanges();

let failed = false;
for (const [dir, tasks] of Object.entries(modules)) {
	if (!stagedFiles.some((file) => file.startsWith(`${dir}/`))) continue;
	// Without a prior build, the tasks would need to fetch crates — not
	// possible in sandboxed runs (pre-commit.ci) and slow on fresh clones.
	if (!hasCargoMake || !existsSync(join(dir, "target"))) {
		if (hasCargoMake)
			console.info(`Skipping ${dir} — crate dependencies not built yet.`);
		continue;
	}
	for (const task of tasks) {
		console.info(`Detected changes in ${dir} — running: ${task.join(" ")}`);
		if (runIn(dir, task) !== 0) failed = true;
	}
}

process.exit(failed ? 1 : 0);
