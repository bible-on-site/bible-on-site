import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { reportBenchmark } from "../util/benchmark";

/**
 * Routes to exercise during memory benchmarking.
 * These should represent typical usage patterns.
 */
const BENCHMARK_ROUTES = [
	"/",
	"/929",
	"/929/1",
	"/929/567",
	"/929/686",
	"/929/188",
	"/929/250",
	"/929/727",
	"/929/764",
];

const BYTES_PER_MB = 1024 * 1024;

/**
 * Measure browser/renderer process memory using Performance API.
 * Uses performance.measureUserAgentSpecificMemory() if available (requires cross-origin isolation),
 * falls back to performance.memory with --enable-precise-memory-info flag hint.
 */
async function measureBrowserMemory(page: Page): Promise<number> {
	try {
		const memory = await page.evaluate(async () => {
			// Try the modern API first (requires cross-origin isolation)
			// @ts-expect-error - measureUserAgentSpecificMemory is not in all TS libs
			if (typeof performance.measureUserAgentSpecificMemory === "function") {
				try {
					// @ts-expect-error - measureUserAgentSpecificMemory is not in all TS libs
					const result = await performance.measureUserAgentSpecificMemory();
					return result.bytes as number;
				} catch {
					// Cross-origin isolation not enabled, fall through
				}
			}

			// Fallback to legacy API (values may be quantized without --enable-precise-memory-info)
			// @ts-expect-error - performance.memory is Chrome-specific
			const perfMemory = performance.memory;
			if (perfMemory) {
				return perfMemory.usedJSHeapSize as number;
			}
			return 0;
		});
		return memory;
	} catch (error) {
		console.warn("Failed to measure browser memory:", error);
		return 0;
	}
}

/**
 * Exercise the page with typical user interactions to trigger memory allocations.
 */
async function exercisePage(page: Page): Promise<void> {
	// Scroll to trigger lazy loading
	await page.evaluate(() => {
		window.scrollTo(0, document.body.scrollHeight / 2);
	});
	await page.waitForTimeout(100);

	// Scroll back to top
	await page.evaluate(() => {
		window.scrollTo(0, 0);
	});
	await page.waitForTimeout(100);

	// Click some interactive elements if they exist
	const buttons = page.locator("button");
	const buttonCount = await buttons.count();
	if (buttonCount > 0) {
		try {
			await buttons.first().click({ timeout: 500 });
		} catch {
			// Button might not be clickable, that's fine
		}
	}
}

test.describe("Browser Memory", () => {
	test("Remains below 1024MB during general interaction", async ({
		page,
	}, testInfo) => {
		const isDesktop = testInfo.project.name === "Desktop";
		const deviceLabel = isDesktop ? "desktop" : "mobile";

		let peakBrowserMemoryBytes = 0;

		// Visit each route and measure memory
		for (const route of BENCHMARK_ROUTES) {
			await page.goto(route);
			await page.waitForLoadState("networkidle");

			// Exercise the page to trigger memory allocations
			await exercisePage(page);

			// Measure browser memory
			const browserMemory = await measureBrowserMemory(page);

			console.log(
				`Route ${route} (${deviceLabel}): browser=${(browserMemory / BYTES_PER_MB).toFixed(1)}MB`,
			);

			peakBrowserMemoryBytes = Math.max(peakBrowserMemoryBytes, browserMemory);
		}

		const peakBrowserMemoryMB = peakBrowserMemoryBytes / BYTES_PER_MB;

		console.log(
			`Overall peak ${deviceLabel} browser memory: ${peakBrowserMemoryMB.toFixed(2)} MB`,
		);

		// Report browser memory per device - high threshold (1024MB) for tracking
		const MAX_BROWSER_MEMORY_MB = 1024;

		if (peakBrowserMemoryBytes > 0) {
			reportBenchmark({
				name: `memory: browser heap (${deviceLabel})`,
				measure: "memory_mb",
				value: peakBrowserMemoryMB,
				upperValue: MAX_BROWSER_MEMORY_MB,
			});

			expect(peakBrowserMemoryMB).toBeLessThan(MAX_BROWSER_MEMORY_MB);
		} else {
			console.warn(
				"Could not measure browser memory (performance.memory not available)",
			);
		}
	});
});
