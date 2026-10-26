#!/usr/bin/env node
/**
 * Pre-commit module runner: executes a command inside a module directory, but
 * only when the module has staged changes (merge-aware — see
 * precommit-changes.mjs and test_precommit_merge.py).
 *
 * usage: node devops/precommit-run.mjs <module-dir> <command...>
 *        node devops/precommit-run.mjs --related <module-dir> <command...> :: <related-command...>
 *
 * --related runs <related-command> with the staged module files appended as
 * module-relative paths — for test runners that narrow to tests covering the
 * changed sources (jest --findRelatedTests, vitest related). It falls back to
 * <command> (the full suite) when a staged file's blast radius exceeds the
 * import graph (config/dotfiles/setup — see FULL_SUITE_PATTERNS), or when the
 * related run reports it matched no tests (running nothing is never a pass).
 * The related command is a full argv because runner syntax differs: jest takes
 * a flag to append, vitest a subcommand — `::` keeps both explicit.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	getStagedChanges,
	runIn,
	runInCapturing,
} from "./precommit-changes.mjs";

// Staged module files matching these can invalidate the whole suite — the
// related import graph can't express their blast radius (or they sit outside
// it entirely), so they always take the <command> path.
const FULL_SUITE_PATTERNS = [
	/^[^/]+$/, // module-root files: package.json, lockfiles, *.config.*, .env*
	/(^|\/)\.[^/]*(\/|$)/, // dotfiles and hidden directories
	/(^|\/)[^/]*\.config\.[^/]*$/, // *.config.* anywhere (playwright.e2e.config.ts, ...)
	/(^|\/)(tsconfig[^/]*|package(-lock)?\.json|bun\.lockb?|bunfig\.toml)$/,
	/(^|\/)([^/]*[.-])?setup[.-]?[^/]*\.[cm]?[jt]sx?$/, // runner setup files (tests/setup.ts, *.setup.js)
	/^(public|scripts)\//, // static assets and build/postinstall scripts
];

// Runners print a distinctive line when the related set maps to zero tests —
// jest exits non-zero with "No tests found"; vitest related defaults
// passWithNoTests and prints "No (affected )?test files found" with exit 0.
const NO_TESTS_PATTERN = /no (affected )?test(s| files)? found/i;

const usage =
	"usage: node devops/precommit-run.mjs [--related] <module-dir> <command...> [:: <related-command...>]";

const args = process.argv.slice(2);
const related = args[0] === "--related";
const [dir, ...command] = related ? args.slice(1) : args;
const separator = command.indexOf("::");
const fullCommand = separator === -1 ? command : command.slice(0, separator);
const relatedCommand = separator === -1 ? null : command.slice(separator + 1);
if (
	!dir ||
	fullCommand.length === 0 ||
	related !== (separator !== -1) ||
	relatedCommand?.length === 0
) {
	console.error(usage);
	process.exit(2);
}

const prefix = `${dir.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
const moduleFiles = getStagedChanges()
	.filter((file) => file.startsWith(prefix))
	.map((file) => file.slice(prefix.length));
if (moduleFiles.length === 0) process.exit(0);

// JS modules can't run their scripts without installed dependencies — e.g.
// pre-commit.ci clones have no node_modules (and module CI is the
// authoritative gate there anyway).
if (
	existsSync(resolve(dir, "package.json")) &&
	!existsSync(resolve(dir, "node_modules"))
) {
	console.info(`Skipping ${dir} — module dependencies not installed.`);
	process.exit(0);
}

if (!related) {
	console.info(`Detected changes in ${dir} — running: ${fullCommand.join(" ")}`);
	process.exit(runIn(resolve(dir), fullCommand));
}

// Filenames cmd.exe would re-interpret can't safely join the shelled argv on
// Windows (spawn only concatenates args — &, %, ^, quotes and whitespace break
// out of the command line) — they take the full-suite path too. POSIX spawns
// argv verbatim, but one rule keeps behavior identical across platforms.
const UNSAFE_ARG_PATTERN = /[\s&%^!"'|<>]/;
const isFullSuiteChange = (file) =>
	UNSAFE_ARG_PATTERN.test(file) ||
	FULL_SUITE_PATTERNS.some((pattern) => pattern.test(file));
if (moduleFiles.some(isFullSuiteChange)) {
	console.info(
		`Detected suite-wide changes in ${dir} — running: ${fullCommand.join(" ")}`,
	);
	process.exit(runIn(resolve(dir), fullCommand));
}

const relatedRun = [...relatedCommand, ...moduleFiles];
console.info(
	`Detected changes in ${dir} — running related: ${relatedRun.join(" ")}`,
);
const { status, output } = await runInCapturing(resolve(dir), relatedRun);
if (!NO_TESTS_PATTERN.test(output)) process.exit(status);

console.info(
	`No related tests matched in ${dir} — running: ${fullCommand.join(" ")}`,
);
process.exit(runIn(resolve(dir), fullCommand));
