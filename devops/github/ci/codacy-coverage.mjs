import { execFileSync } from "node:child_process";
import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The combined LCOV contains every module, plus the Python operational suites.
// Codacy otherwise selects only the first detected language from that report.
export const CODACY_COVERAGE_LANGUAGES = Object.freeze([
	"TypeScript",
	"Javascript",
	"Python",
	"CSharp",
	"Rust",
]);

export function findCodacyReporter(directory) {
	const binaries = readdirSync(directory, {
		recursive: true,
		withFileTypes: true,
	})
		.filter(
			(entry) => entry.isFile() && entry.name === "codacy-coverage-reporter",
		)
		.map((entry) => join(entry.parentPath, entry.name));
	if (binaries.length !== 1) {
		throw new Error("Expected one downloaded native Codacy reporter");
	}
	accessSync(binaries[0], constants.X_OK);
	return resolve(binaries[0]);
}

export function publishCodacyCoverage(
	reporterDirectory,
	report,
	{ env = process.env, run = execFileSync } = {},
) {
	if (!env.CODACY_PROJECT_TOKEN?.trim()) {
		throw new Error(
			"CODACY_PROJECT_TOKEN is required for coverage publication",
		);
	}
	if (!statSync(report).isFile()) {
		throw new Error("Codacy coverage report must be a file");
	}
	const binary = findCodacyReporter(reporterDirectory);
	const coverage = resolve(report);
	const options = { env, stdio: "inherit" };
	// https://docs.codacy.com/coverage-reporter/uploading-coverage-in-advanced-scenarios/#uploading-the-same-coverage-report-for-multiple-languages
	for (const language of CODACY_COVERAGE_LANGUAGES) {
		run(
			binary,
			["report", "--partial", "-l", language, "-r", coverage],
			options,
		);
	}
	// Any failed partial upload throws above: never finalize an incomplete set.
	run(binary, ["final"], options);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	publishCodacyCoverage(process.argv[2], process.argv[3]);
}
