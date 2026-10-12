#!/usr/bin/env node
/**
 * Pre-commit module runner: executes a command inside a module directory, but
 * only when the module has staged changes (merge-aware — see
 * precommit-changes.mjs and test_precommit_merge.py).
 *
 * usage: node devops/precommit-run.mjs <module-dir> <command...>
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getStagedChanges, runIn } from "./precommit-changes.mjs";

const [dir, ...command] = process.argv.slice(2);
if (!dir || command.length === 0) {
	console.error("usage: node devops/precommit-run.mjs <module-dir> <command...>");
	process.exit(2);
}

const prefix = `${dir.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
if (!getStagedChanges().some((file) => file.startsWith(prefix)))
	process.exit(0);

// npm modules can't run their scripts without installed dependencies — e.g.
// pre-commit.ci clones have no node_modules (and module CI is the
// authoritative gate there anyway).
if (
	existsSync(resolve(dir, "package.json")) &&
	!existsSync(resolve(dir, "node_modules"))
) {
	console.info(`Skipping ${dir} — module dependencies not installed.`);
	process.exit(0);
}

console.info(`Detected changes in ${dir} — running: ${command.join(" ")}`);
process.exit(runIn(resolve(dir), command));
