import {
	type BrowserContext,
	expect,
	type Page,
	test as testBase,
} from "@playwright/test";
import libCoverage from "istanbul-lib-coverage";
import libSourceMaps from "istanbul-lib-source-maps";
import { addCoverageReport } from "monocart-reporter";
import { dumpImpactCoverage } from "../../../shared/tests-util/e2e-impact";
import { shouldMeasureCov } from "../../../shared/tests-util/environment.mjs";

declare global {
	interface Window {
		__coverage__?: Record<string, unknown>;
		collectIstanbulCoverage?: (
			coverage?: Record<string, unknown>,
			realm?: "browser" | "server",
		) => void;
	}
}

/**
 * E2E test entry point. When MEASURE_COV=1 (bun run coverage:e2e), drains
 * istanbul `__coverage__` from both realms per test: instrumented client code
 * writes `window.__coverage__`, while instrumented Nitro SSR modules write to
 * the dev server's globalThis — exposed via /api/dev/coverage. SSR entries are
 * instrumented post-transform, so their embedded inputSourceMap must be applied
 * to restore original source positions before the data reaches monocart.
 */
export const test = testBase.extend({
	context: async ({ context }, use) => {
		if (shouldMeasureCov) await setupCoverageCollection(context);

		await use(context);

		if (shouldMeasureCov) {
			for (const page of context.pages()) {
				await drainPageCoverage(page);
			}
		}
	},
});

async function drainPageCoverage(page: Page) {
	// Skip pages that never navigated (e.g. skipped tests)
	const url = page.url();
	if (!url || url === "about:blank" || !url.startsWith("http")) return;

	await page.evaluate(async () => {
		if (window.__coverage__) {
			window.collectIstanbulCoverage?.(window.__coverage__);
		}
		// Server-side counters accumulate on the shared Nitro dev-server
		// process, so this drain is tagged "server" for the impact collector.
		const res = await fetch("/api/dev/coverage");
		const serverCoverage = await res.json();
		if (serverCoverage && Object.keys(serverCoverage).length > 0) {
			window.collectIstanbulCoverage?.(serverCoverage, "server");
		}
	});
}

async function setupCoverageCollection(context: BrowserContext) {
	const sourceMapStore = libSourceMaps.createSourceMapStore();
	await context.addInitScript(() =>
		window.addEventListener("beforeunload", () => {
			window.collectIstanbulCoverage?.(window.__coverage__);
		}),
	);
	await context.exposeFunction(
		"collectIstanbulCoverage",
		async (
			coverage?: Record<string, unknown>,
			realm: "browser" | "server" = "browser",
		) => {
			if (!coverage || Object.keys(coverage).length === 0) return;
			// transformCoverage is a no-op for entries without inputSourceMap.
			const remapped = await sourceMapStore.transformCoverage(
				libCoverage.createCoverageMap(coverage as libCoverage.CoverageMapData),
			);
			// Per-test evidence for the deterministic e2e-impact selector
			// (#2085): the remapped map lands under .coverage/e2e-impact/.
			dumpImpactCoverage(test.info(), realm, remapped.data);
			void addCoverageReport(remapped.data, test.info());
		},
	);
}

export { expect };
