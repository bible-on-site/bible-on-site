import { expect, test as testBase } from "@playwright/test";
import { addCoverageReport } from "monocart-reporter";
import { shouldMeasureCov } from "../../../shared/tests-util/environment.mjs";

/**
 * E2E test entry point. When MEASURE_COV=1 (npm run coverage:e2e), wraps every
 * `page` with Chromium V8 coverage collection; monocart-reporter converts the
 * raw V8 data through Vite's sourcemaps into .coverage/e2e/lcov.info.
 * Server-side (Nitro) coverage is collected separately by the global teardown.
 */
export const test = testBase.extend({
	page: async ({ page }, use) => {
		if (shouldMeasureCov) {
			await page.coverage.startJSCoverage({ resetOnNavigation: false });
		}
		await use(page);
		if (shouldMeasureCov) {
			const coverage = await page.coverage.stopJSCoverage();
			await addCoverageReport(coverage, test.info());
		}
	},
});

export { expect };
