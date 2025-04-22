const { CoverageReporter } = require("@jest/reporters");
const { CoverageReport } = require("monocart-coverage-reports");
import { filterOutCoverageRedundantFiles } from "../../coverage/filter-out-coverage-redundant-files";
const fs = require("node:fs");
class MonocartCoverageReporter extends CoverageReporter {
	constructor(globalConfig, reporterOptions, reporterContext) {
		super(globalConfig, reporterContext);
		this.disabled = !globalConfig.collectCoverage;
		this.coverageProvider = globalConfig.coverageProvider;
		this.reporterOptions = reporterOptions;
	}

	onTestResult(...args) {
		if (this.disabled) {
			return;
		}
		super.onTestResult.apply(this, args);
	}

	async onRunComplete(testContexts, results) {
		if (this.disabled) {
			return;
		}
		await this._addUntestedFiles(testContexts);

		const coverage = await this._sourceMapStore.transformCoverage(
			this._coverageMap,
		);
		filterOutCoverageRedundantFiles(coverage.data);
		this.reporterOptions.sourceFinder = this._sourceMapStore.sourceFinder;

		const coverageReport = new CoverageReport(this.reporterOptions);
		coverageReport.cleanCache();
		await coverageReport.add(coverage);
		await coverageReport.generate();

		// Fixes path formatting in LCOV files for Windows paths
		const lcovPath = ".coverage/unit/lcov.info";
		const content = fs.readFileSync(lcovPath, "utf8");
		const fixedContent = content.replace(/SF:C\\/g, "SF:C:\\");
		fs.writeFileSync(lcovPath, fixedContent);
	}
}

module.exports = MonocartCoverageReporter;
