/**
 * Jest setup file for collecting SWC coverage instrumentation data.
 * This file is only used when MEASURE_COV=1 is set.
 *
 * The SWC coverage plugin instruments code to store coverage in global.__coverage__.
 * However, Jest reporters run in a separate process and can't access test globals directly.
 * We use this setup file to write coverage to a file after all tests complete.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
	mergeIstanbulCoverage,
} = require("./tests/util/coverage/merge-istanbul-coverage");

const COVERAGE_FILE = path.join(
	process.cwd(),
	".coverage",
	"unit",
	"istanbul-coverage.json",
);

// Create the coverage directory if it doesn't exist
const coverageDir = path.dirname(COVERAGE_FILE);
if (!fs.existsSync(coverageDir)) {
	fs.mkdirSync(coverageDir, { recursive: true });
}

// Write coverage data after all tests complete
afterAll(() => {
	// Access the global coverage object that SWC's plugin creates
	// biome-ignore lint/suspicious/noShadowRestrictedNames: we need to use the exact global name to call its constructor
	const Function = (() => {}).constructor;
	// biome-ignore lint/suspicious/noShadowRestrictedNames: we need the real globalThis, not the one from the test environment
	const globalThis = new Function("return this")();
	const coverage = globalThis.__coverage__;

	if (coverage && Object.keys(coverage).length > 0) {
		// Read existing coverage and merge with new coverage
		let existingCoverage = {};
		if (fs.existsSync(COVERAGE_FILE)) {
			try {
				existingCoverage = JSON.parse(fs.readFileSync(COVERAGE_FILE, "utf8"));
			} catch {
				// File might be empty or corrupted, start fresh
			}
		}

		const mergedCoverage = mergeIstanbulCoverage(existingCoverage, coverage);

		console.log(
			`[jest.coverage-setup] Writing coverage for ${Object.keys(mergedCoverage).length} files`,
		);
		fs.writeFileSync(COVERAGE_FILE, JSON.stringify(mergedCoverage, null, 2));
	} else {
		console.log("[jest.coverage-setup] No coverage data found");
	}
});
