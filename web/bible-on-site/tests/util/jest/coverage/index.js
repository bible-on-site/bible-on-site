const { CoverageReporter } = require("@jest/reporters");
const { CoverageReport } = require("monocart-coverage-reports");
import { filterOutCoverageRedundantFiles } from "../../coverage/filter-out-coverage-redundant-files.js";
class MonocartCoverageReporter extends CoverageReporter {
	constructor(globalConfig, reporterOptions, reporterContext) {
		super(globalConfig, reporterContext);
		this.disabled = !globalConfig.collectCoverage;
		this.coverageProvider = globalConfig.coverageProvider;
		this.reporterOptions = reporterOptions;
	}

	onTestResult() {
		if (this.disabled) {
			return;
		}
		super.onTestResult.apply(this, arguments);
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
	}
}

module.exports = MonocartCoverageReporter;
