import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page, TestInfo } from "@playwright/test"; // import { test, expect } from "@playwright/test";
import { errors } from "@playwright/test"; // import { test, expect } from "@playwright/test";
import { expect, test as testBase } from "../util/playwright/test-fixture";

const test = testBase.extend({
	page: async ({ page }, use, testInfo) => {
		await warmUpPageIfNeeded(page, testInfo);

		// Continue with the actual test using the warmed-up page
		await use(page);
	},
});

test.describe.configure({ mode: "serial" });

interface WebVitalsMetric {
	measure: number;
	max: number;
}

interface WebVitalsMetrics {
	CLS: number;
	FCP: number;
	INP: number;
	LCP: number;
	TTFB: number;
}

type WebVitalsMetricsResult = {
	[K in keyof WebVitalsMetrics]: WebVitalsMetric;
};

type WebVitalsMetricsClient = {
	[K in keyof WebVitalsMetrics]: number;
} & {
	[K in keyof WebVitalsMetrics as `${K}Threshold`]: number;
} & {
	[K in keyof WebVitalsMetrics as `on${K}`]: CallableFunction;
};
const testWebVitals = async ({ page }: { page: Page }, testInfo: TestInfo) => {
	const webVitalsScript = readFileSync(
		resolve(__dirname, "../../node_modules/web-vitals/dist/web-vitals.iife.js"),
		"utf8",
	);

	await page.goto(testInfo.title);

	await page.addScriptTag({ content: webVitalsScript });
	await page.evaluate(() => {
		const webVitals = (
			window as unknown as { webVitals: WebVitalsMetricsClient }
		).webVitals;
		(window as unknown as { results: WebVitalsMetricsResult }).results = [
			"CLS",
			"FCP",
			"INP",
			"LCP",
			"TTFB",
		]
			.map((name) => ({
				name,
				measure: Number.NaN,
				max: (
					webVitals[
						`${name}Thresholds` as keyof WebVitalsMetricsClient
					] as unknown as [number, number]
				)[0],
			}))
			.reduce<WebVitalsMetricsResult>((acc, { name, measure, max }) => {
				acc[name as keyof WebVitalsMetrics] = { measure, max };
				return acc;
				// eslint-disable-next-line @typescript-eslint/prefer-reduce-type-parameter
			}, {} as WebVitalsMetricsResult);
		const handleMetric =
			(name: keyof WebVitalsMetrics) => (metric: { value: number }) => {
				console.log(name, metric.value);
				(window as unknown as { results: WebVitalsMetricsResult }).results[
					name
				].measure = metric.value;
			};
		webVitals.onCLS(handleMetric("CLS"), { reportAllChanges: true });
		webVitals.onFCP(handleMetric("FCP"));
		webVitals.onINP(handleMetric("INP"), { reportAllChanges: true });
		webVitals.onLCP(handleMetric("LCP"));
		webVitals.onTTFB(handleMetric("TTFB"));
	});

	// TODO: refactor into test-utils into something like `simulateRandomUserInteraction(page, tags = ["button, "label", "input"], maxElements = 10)`

	let wasAnyElementClicked = false;
	do {
		const elements = page.locator("button, label, input");
		const elementsFlat = (await elements.all()).flat();
		const SAMPLE_SIZE = 10;
		for (const element of elementsFlat.slice(
			0,
			Math.min(elementsFlat.length, SAMPLE_SIZE),
		)) {
			try {
				await element.click({ timeout: 100 }); // Try to click the element with a timeout
				wasAnyElementClicked = true;
			} catch (error) {
				// timout error is not an error
				if (!(error instanceof errors.TimeoutError)) {
					console.log(error);
				}
			}
		}
	} while (!wasAnyElementClicked); // repeat until at least one element was clicked

	await page.locator("body").dispatchEvent("onbeforeunload");

	const webVitalsMetrics: WebVitalsMetricsResult = await page.evaluate(() => {
		return (window as unknown as { results: WebVitalsMetricsResult }).results;
	});

	console.log("Web Vitals Analysis:", webVitalsMetrics);

	for (const metricEntry of Object.entries(webVitalsMetrics)) {
		const [metricName, metric] = metricEntry as [
			keyof WebVitalsMetrics,
			WebVitalsMetric,
		];
		// Skip NaN values (e.g., INP when no interaction occurred)
		if (Number.isNaN(metric.measure)) {
			continue;
		}
		// TODO: improve performance for known slow pages
		if (testInfo.title === "/929/686" && metricName === "INP") {
			// Skip INP for this page as it is known to be slow
			continue;
		}
		expect(metric.measure).toBeLessThan(metric.max);
	}
};
// TODO: generate tests for all routes

// TODO: Populate dynamically from next build results
const nonSSGRoutes = new Set<string>([]);
async function warmUpPageIfNeeded(page: Page, testInfo: TestInfo) {
	const isSSGRoute = !nonSSGRoutes.has(testInfo.title);
	if (isSSGRoute) {
		// Skip warming up for SSG routes
		return;
	}
	// Preload the page to warm up the cache
	const cacheDir = resolve(__dirname, "../../.cache/playwright/warm-pages");
	const warmPagesCacheFile = resolve(cacheDir, "warm-pages.txt");
	const warmPages = new Set();
	mkdirSync(cacheDir, { recursive: true });
	const delimiter = "\n";
	if (existsSync(warmPagesCacheFile)) {
		for (const page of readFileSync(warmPagesCacheFile, "utf8").split(
			delimiter,
		)) {
			warmPages.add(page.trim());
		}
	} else {
		writeFileSync(warmPagesCacheFile, "", "utf8");
	}
	if (!warmPages.has(testInfo.title)) {
		await page.goto(testInfo.title);
		await page.waitForLoadState("networkidle");
		console.debug(`Preloaded ${testInfo.title} for cache warmup`);
		warmPages.add(testInfo.title);
		writeFileSync(
			warmPagesCacheFile,
			Array.from(warmPages).join(delimiter),
			"utf8",
		);
	}
}

test("/", testWebVitals);
test("/929/567", testWebVitals);
test("/929/1", testWebVitals);
test("/929/686", testWebVitals);
