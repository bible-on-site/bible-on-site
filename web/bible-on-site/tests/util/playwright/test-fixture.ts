import {
	type BrowserContext,
	expect,
	type Page,
	test as testBase,
} from "@playwright/test";
import { addCoverageReport } from "monocart-reporter";
import { dumpImpactCoverage } from "../../../../shared/tests-util/e2e-impact.mjs";
import { shouldMeasureCov } from "../../../../shared/tests-util/environment.mjs";
import { TABLET_MIN_WIDTH } from "../../../src/hooks/useIsWideEnough";
import { sanitizeCoverage } from "../coverage/sanitize-coverage";

declare global {
	interface Window {
		collectIstanbulCoverage: (
			coverage?: CoverageData,
			realm?: "browser" | "server",
		) => void;
	}
}

const test = testBase.extend<{
	isWideEnough: boolean;
	skipOnNotWideEnough: undefined;
}>({
	/**
	 * Fixture that returns true if the current viewport is tablet or larger (>= 768px)
	 */
	isWideEnough: async ({ page }, use) => {
		const viewportWidth = page.viewportSize()?.width ?? 0;
		await use(viewportWidth >= TABLET_MIN_WIDTH);
	},

	/**
	 * Fixture that skips the test on mobile viewports.
	 * Usage: include `skipOnNotWideEnough` in your test's destructured params.
	 * The underscore prefix silences unused variable warnings.
	 */
	skipOnNotWideEnough: [
		async ({ page }, use, testInfo) => {
			const viewportWidth = page.viewportSize()?.width ?? 0;
			if (viewportWidth < TABLET_MIN_WIDTH) {
				testInfo.skip(
					true,
					`Test requires tablet+ viewport (${viewportWidth}px < ${TABLET_MIN_WIDTH}px)`,
				);
			}
			await use(undefined);
		},
		{ auto: false },
	],

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
	// Skip coverage collection for pages that haven't navigated (e.g., skipped tests)
	const url = page.url();
	if (!url || url === "about:blank" || !url.startsWith("http")) {
		return;
	}

	await page.evaluate(async () => {
		if (window.__coverage__) {
			window.collectIstanbulCoverage(window.__coverage__);
		} else {
			// If __coverage__ is not available (possibly due to server-side route), fetch it via API.
			// Server-side counters accumulate on the shared dev-server process,
			// so this drain is tagged "server" for the impact collector.
			const res = await fetch("/api/dev/coverage");
			const coverage = await res.json();
			window.collectIstanbulCoverage(coverage, "server");
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
		(coverage?: CoverageData, realm: "browser" | "server" = "browser") => {
			if (coverage) {
				sanitizeCoverage(coverage as never); // TODO: fix types / migrate sanitizeCoverage to TS
				if (Object.keys(coverage).length > 0) {
					// Per-test evidence for the deterministic e2e-impact selector
					// (#2085): the map lands under .coverage/e2e-impact/coverage/.
					dumpImpactCoverage(test.info(), realm, coverage);
					addCoverageReport(coverage, test.info());
				}
			}
		},
	);
}

export { test, expect };
