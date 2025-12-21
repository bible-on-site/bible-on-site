import { execSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
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

function mergeCoverage(): void {
	// Both unit and e2e tests now use swc-plugin-coverage-instrument for consistent branch line mappings
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
