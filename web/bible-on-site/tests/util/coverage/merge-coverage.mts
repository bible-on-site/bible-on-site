import { execSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { normalizeLcovFile } from "./normalize-coverage.mjs";

const COVERAGE_DIR = `${process.env.npm_config_local_prefix}/.coverage`;

const DEBUG_TARGET_FILE = "SeferComposite.tsx";
const DEBUG_DIR = `${COVERAGE_DIR}/debug`;
const DEBUG_TARGETS = [
	{ label: "unit", path: `${COVERAGE_DIR}/unit/lcov.info` },
	{ label: "e2e", path: `${COVERAGE_DIR}/e2e/lcov.info` },
];

const UNIT_LCOV = `${COVERAGE_DIR}/unit/lcov.info`;
const E2E_LCOV = `${COVERAGE_DIR}/e2e/lcov.info`;
const NORMALIZED_UNIT_LCOV = `${COVERAGE_DIR}/unit/lcov.normalized.info`;
const NORMALIZED_E2E_LCOV = `${COVERAGE_DIR}/e2e/lcov.normalized.info`;

mkdirSync(`${COVERAGE_DIR}/merged`, { recursive: true });
dumpTargetCoverage();
normalizeCoverageFiles();
mergeCoverage();
fixLcovPathsForCodecov();
printCoverageSummary();

function mergeCoverage(): void {
	// Both unit and e2e tests now use swc-plugin-coverage-instrument for consistent branch line mappings.
	// Inconsistent branch data (e.g. single-branch blocks from SWC ternary instrumentation) is fixed
	// during normalization — see fixInconsistentBranches() in normalize-coverage.mts.
	const cmd = `docker run --rm -t -v ${COVERAGE_DIR}:/.coverage lcov-cli:0.0.2 --rc branch_coverage=1 -a /.coverage/unit/lcov.normalized.info -a /.coverage/e2e/lcov.normalized.info -o /.coverage/merged/lcov.info`;

	const out = runCommand(cmd);
	if (out) console.log(formatOutput(out));
}

function normalizeCoverageFiles(): void {
	const unitRenamed = normalizeLcovFile(UNIT_LCOV, NORMALIZED_UNIT_LCOV);
	console.log(`Normalized ${unitRenamed} function names in ${UNIT_LCOV}`);

	const e2eRenamed = normalizeLcovFile(E2E_LCOV, NORMALIZED_E2E_LCOV);
	console.log(`Normalized ${e2eRenamed} function names in ${E2E_LCOV}`);
}

function dumpTargetCoverage(): void {
	mkdirSync(DEBUG_DIR, { recursive: true });

	for (const target of DEBUG_TARGETS) {
		const snippet = extractCoverageSection(target.path, DEBUG_TARGET_FILE);
		const outputPath = `${DEBUG_DIR}/${DEBUG_TARGET_FILE.replace(/\W+/g, "_")}.${target.label}.txt`;
		const content =
			snippet ??
			`Coverage snippet for ${target.label} missing ${DEBUG_TARGET_FILE}\n`;
		copyCoverageFile(target.path, `${DEBUG_DIR}/${target.label}.lcov.info`);
		writeFileSync(outputPath, content, "utf8");
		console.log(`Debug snippet for ${target.label} written to ${outputPath}`);
	}
}

function extractCoverageSection(
	filePath: string,
	targetFile: string,
): string | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}

	const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
	const sections = [];
	let capturing = false;
	let buffer = [];

	for (const line of lines) {
		if (line.startsWith("SF:")) {
			if (capturing && buffer.length) {
				sections.push(buffer.join("\n"));
				buffer = [];
			}

			capturing = line.includes(targetFile);
			if (capturing) {
				buffer.push(line);
			}
			continue;
		}

		if (capturing) {
			buffer.push(line);
			if (line === "end_of_record") {
				sections.push(buffer.join("\n"));
				buffer = [];
				capturing = false;
			}
		}
	}

	if (capturing && buffer.length) {
		sections.push(buffer.join("\n"));
	}

	return sections.length ? sections.join("\n\n") : undefined;
}

function copyCoverageFile(source: string, destination: string): void {
	if (!existsSync(source)) {
		console.log(`Coverage file not found: ${source}`);
		return;
	}

	copyFileSync(source, destination);
	console.log(`Copied coverage file to ${destination}`);
}

function runCommand(cmd: string): Buffer | undefined {
	try {
		return execSync(cmd);
	} catch (e: unknown) {
		printExecError(cmd, e);
		process.exit(1);
	}
}

function formatOutput(value: unknown): string {
	if (typeof value === "undefined" || value === null) return "";
	if (Buffer.isBuffer(value)) return value.toString();
	return String(value);
}

function printExecError(cmd: string, error: unknown): void {
	console.error("\nError merging coverage");
	console.error("Command :", cmd);

	if (typeof error === "object" && error !== null) {
		const err = error as {
			status?: number;
			stdout?: unknown;
			stderr?: unknown;
			message?: unknown;
			stack?: unknown;
		};

		if (typeof err.status !== "undefined")
			console.error("Exit code :", err.status);

		if (typeof err.stdout !== "undefined")
			console.error("Stdout   :", formatOutput(err.stdout));

		if (typeof err.stderr !== "undefined")
			console.error("Stderr   :", formatOutput(err.stderr));

		if (err.message && !err.stderr)
			console.error("Message  :", String(err.message));

		if (err.stack) console.error("Stack    :", String(err.stack));
	} else {
		console.error("Error    :", String(error));
	}
}

/**
 * Prefix LCOV source paths so Codecov can match them to the repository layout.
 *
 * The merged LCOV file contains paths relative to the package root (e.g.
 * `SF:src/app/page.tsx`), but Codecov flags reference paths from the repo root
 * (e.g. `web/bible-on-site/src/`).  This step adds the missing prefix.
 */
function fixLcovPathsForCodecov(): void {
	const mergedLcov = `${COVERAGE_DIR}/merged/lcov.info`;
	if (!existsSync(mergedLcov)) {
		console.log("Merged LCOV not found, skipping path prefix fix");
		return;
	}

	const prefix = getMonorepoPrefix();
	if (!prefix) {
		console.log(
			"Could not determine monorepo prefix, skipping LCOV path fix",
		);
		return;
	}

	const original = readFileSync(mergedLcov, "utf8");
	// Handle both forward-slash (Linux/CI) and back-slash (Windows) SF entries
	const fixed = original
		.replace(/^SF:src\//gm, `SF:${prefix}src/`)
		.replace(/^SF:src\\/gm, `SF:${prefix}src/`);

	if (fixed !== original) {
		writeFileSync(mergedLcov, fixed, "utf8");
		console.log(`Fixed LCOV paths: added prefix '${prefix}'`);
	} else {
		console.log("LCOV paths already prefixed or nothing to fix");
	}
}

/** Derive the package directory relative to the git repo root (e.g. `web/bible-on-site/`). */
function getMonorepoPrefix(): string | null {
	try {
		const gitRoot = execSync("git rev-parse --show-toplevel", {
			encoding: "utf8",
		}).trim();
		const packageDir =
			process.env.npm_config_local_prefix ?? process.cwd();
		const rel = relative(resolve(gitRoot), resolve(packageDir)).replace(
			/\\/g,
			"/",
		);
		return rel ? `${rel}/` : null;
	} catch {
		return null;
	}
}

/** Parse the merged LCOV and print a human-readable coverage summary. */
function printCoverageSummary(): void {
	const mergedLcov = `${COVERAGE_DIR}/merged/lcov.info`;
	if (!existsSync(mergedLcov)) {
		console.log("Merged LCOV not found, skipping summary");
		return;
	}

	const content = readFileSync(mergedLcov, "utf8");
	let linesFound = 0;
	let linesHit = 0;
	let branchesFound = 0;
	let branchesHit = 0;
	let functionsFound = 0;
	let functionsHit = 0;

	for (const line of content.split(/\r?\n/)) {
		if (line.startsWith("LF:")) {
			linesFound += Number(line.slice(3));
		} else if (line.startsWith("LH:")) {
			linesHit += Number(line.slice(3));
		} else if (line.startsWith("BRF:")) {
			branchesFound += Number(line.slice(4));
		} else if (line.startsWith("BRH:")) {
			branchesHit += Number(line.slice(4));
		} else if (line.startsWith("FNF:")) {
			functionsFound += Number(line.slice(4));
		} else if (line.startsWith("FNH:")) {
			functionsHit += Number(line.slice(4));
		}
	}

	const pct = (hit: number, total: number) =>
		total > 0 ? ((hit * 100) / total).toFixed(2) : "N/A";

	const total = linesFound + branchesFound;
	const hit = linesHit + branchesHit;

	console.log("\n=== Merged Coverage Summary ===");
	console.log(
		`  Lines:     ${linesHit}/${linesFound} (${pct(linesHit, linesFound)}%)`,
	);
	console.log(
		`  Branches:  ${branchesHit}/${branchesFound} (${pct(branchesHit, branchesFound)}%)`,
	);
	console.log(
		`  Functions: ${functionsHit}/${functionsFound} (${pct(functionsHit, functionsFound)}%)`,
	);
	if (total > 0) {
		console.log(`  Combined:  ${pct(hit, total)}% (Codecov metric)`);
	}
	console.log("===============================\n");
}
