import {
	type BrowserContext,
	type Page,
	expect,
	test as testBase,
} from "@playwright/test";
import { shouldMeasureCov } from "../environment.mjs";
import { addCoverageReport } from "monocart-reporter";
import { filterOutCoverageRedundantFiles } from "../coverage/filter-out-coverage-redundant-files";
declare global {
	interface Window {
		collectIstanbulCoverage: (coverage?: CoverageData) => void;
	}
}

const test = testBase.extend({
	context: async ({ context }, use) => {
		if (shouldMeasureCov) await coverageSetup(context);

		await use(context);

		for (const page of context.pages()) {
			if (shouldMeasureCov) await handlePageCoverage(page);
		}
		return;
	},
});

async function handlePageCoverage(page: Page) {
	await page.evaluate(async () => {
		if (window.__coverage__) {
			window.collectIstanbulCoverage(window.__coverage__);
		} else {
			// If __coverage__ is not available (possibly due to server-side route), fetch it via API.
			const res = await fetch("/api/dev/coverage");
			const coverage = await res.json();
			window.collectIstanbulCoverage(coverage);
		}
	});
}

async function coverageSetup(context: BrowserContext) {
	await context.addInitScript(() =>
		window.addEventListener("beforeunload", () => {
			window.collectIstanbulCoverage(window.__coverage__);
		}),
	);
	await context.exposeFunction(
		"collectIstanbulCoverage",
		(coverage?: CoverageData) => {
			if (coverage) {
				filterOutCoverageRedundantFiles(coverage);
				if (Object.keys(coverage).length > 0) {
					addCoverageReport(coverage, test.info());
				}
			}
		},
	);
}

export { test, expect };
