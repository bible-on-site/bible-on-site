const { CoverageReport } = require("monocart-coverage-reports");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// ESM sanitize-coverage module - loaded dynamically since this is CommonJS
let sanitizeCoverageModule = null;

const COVERAGE_FILE = path.join(
	process.cwd(),
	".coverage",
	"unit",
	"istanbul-coverage.json",
);

/**
 * Custom Jest reporter that collects coverage from SWC's coverage instrumentation plugin.
 * This uses the same `swc-plugin-coverage-instrument` as Next.js, ensuring consistent
 * branch line mappings between unit and e2e tests.
 *
 * The coverage data is written to a file by jest.coverage-setup.js after tests complete,
 * and this reporter reads it to generate the LCOV report.
 */
class MonocartCoverageReporter {
	constructor(globalConfig, reporterOptions) {
		this.globalConfig = globalConfig;
		this.reporterOptions = reporterOptions;
	}

	// biome-ignore lint/correctness/noUnusedFunctionParameters: framework required function signature
	async onRunComplete(testContexts, results) {
		// Load ESM sanitize-coverage module (dynamic import required from CommonJS)
		if (!sanitizeCoverageModule) {
			const modulePath = path.resolve(__dirname, "../../coverage/sanitize-coverage.js");
			sanitizeCoverageModule = await import(pathToFileURL(modulePath).href);
		}
		const sanitizeCoverage = sanitizeCoverageModule.sanitizeCoverage
			|| sanitizeCoverageModule.default?.sanitizeCoverage
			|| sanitizeCoverageModule.default;

		// Read coverage from the file written by jest.coverage-setup.js
		if (!fs.existsSync(COVERAGE_FILE)) {
			console.warn(
				`[MonocartCoverageReporter] Coverage file not found: ${COVERAGE_FILE}`,
			);
			return;
		}

		const coverageData = JSON.parse(fs.readFileSync(COVERAGE_FILE, "utf8"));

		if (!coverageData || Object.keys(coverageData).length === 0) {
			console.warn("[MonocartCoverageReporter] No coverage data in file");
			return;
		}

		console.log(
			`[MonocartCoverageReporter] Processing coverage for ${Object.keys(coverageData).length} files`,
		);

		sanitizeCoverage(coverageData);

		const coverageReport = new CoverageReport(this.reporterOptions);
		coverageReport.cleanCache();
		await coverageReport.add(coverageData);
		await coverageReport.generate();

		// Fixes path formatting in LCOV files for Windows paths
		const lcovPath = ".coverage/unit/lcov.info";
		if (fs.existsSync(lcovPath)) {
			const content = fs.readFileSync(lcovPath, "utf8");
			// TODO: support any drive letter, not just C:
			const fixedContent = content.replace(/SF:C\\/g, "SF:C:\\");
			fs.writeFileSync(lcovPath, fixedContent);
		}

		// Clean up the intermediate coverage file
		if (fs.existsSync(COVERAGE_FILE)) {
			fs.unlinkSync(COVERAGE_FILE);
		}
	}
}

module.exports = MonocartCoverageReporter;
