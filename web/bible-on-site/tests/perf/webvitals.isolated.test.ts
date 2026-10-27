import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, type Page, type TestInfo } from "@playwright/test";
import { type BencherMeasure, reportBenchmark } from "../util/benchmark";
import { SeferPage } from "../util/playwright/page-objects/sefer-page";
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
const testWebVitals = async (
	{ page }: { page: Page },
	testInfo: TestInfo,
	device: string,
) => {
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
		webVitals.onINP(handleMetric("INP"), {
			reportAllChanges: true,
			durationThreshold: 16,
		});
		webVitals.onLCP(handleMetric("LCP"), { reportAllChanges: true });
		webVitals.onTTFB(handleMetric("TTFB"));
	});

	// Exercise real controls with their normal actionability checks. Sampling
	// hidden elements with 100ms clicks can perform an action and still time out,
	// leaving an unbounded retry loop while the menu blocks later controls.
	const menu = page.getByRole("button", { name: "תפריט ראשי", exact: true });
	await menu.click();
	await expect(menu).toHaveAttribute("aria-expanded", "true");
	await page.keyboard.press("Escape");
	await expect(menu).toHaveAttribute("aria-expanded", "false");
	if (testInfo.title !== "/" && device === "desktop") {
		const reader = new SeferPage(page);
		await reader.openSeferView();
		await reader.verifyPesukimAreVisible();
		await reader.closeSeferView();
	}

	// INP is reported after the next paint/idle callback. Reading immediately
	// after a click used to silently skip homepage INP as NaN. A synthetic
	// "onbeforeunload" event does not finalize Web Vitals.
	let webVitalsMetrics: WebVitalsMetricsResult;
	try {
		await page.waitForFunction(() =>
			Object.values(
				(window as unknown as { results: WebVitalsMetricsResult }).results,
			).every((metric) => Number.isFinite(metric.measure)),
		);
	} finally {
		webVitalsMetrics = await page.evaluate(
			() => (window as unknown as { results: WebVitalsMetricsResult }).results,
		);
		const diagnostic = JSON.stringify(
			{
				url: page.url(),
				device,
				environment: "ci-lab",
				metrics: webVitalsMetrics,
			},
			null,
			2,
		);
		const diagnosticsDir = resolve(
			__dirname,
			"../../.playwright-report/perf/diagnostics/webvitals",
		);
		mkdirSync(diagnosticsDir, { recursive: true });
		writeFileSync(
			resolve(
				diagnosticsDir,
				`${device}${testInfo.title.replace(/\//g, "_")}.json`,
			),
			diagnostic,
		);
		await testInfo.attach("web-vitals", {
			body: diagnostic,
			contentType: "application/json",
		});
	}

	console.log("Web Vitals Analysis:", webVitalsMetrics);

	for (const metricEntry of Object.entries(webVitalsMetrics)) {
		const [metricName, metric] = metricEntry as [
			keyof WebVitalsMetrics,
			WebVitalsMetric,
		];
		expect(
			Number.isFinite(metric.measure),
			`${metricName} must be collected for ${testInfo.title} (${device})`,
		).toBe(true);

		// Map Web Vitals metric names to unified Bencher measures
		// CLS is a ratio (unitless), all others are timing (milliseconds)
		const measure: BencherMeasure = metricName === "CLS" ? "ratio" : "time_ms";

		// Export metric to benchmark file for historical tracking (Bencher format)
		reportBenchmark({
			name: `webvitals: ${metricName} (${testInfo.title}, ${device})`,
			measure,
			value: metric.measure,
			upperValue: metric.max,
		});
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
		for (const warmPage of readFileSync(warmPagesCacheFile, "utf8").split(
			delimiter,
		)) {
			warmPages.add(warmPage.trim());
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

for (const device of ["desktop", "mobile"] as const) {
	test.describe(device, () => {
		const descriptor =
			devices[device === "mobile" ? "Pixel 5" : "Desktop Chrome"];
		// defaultBrowserType is worker-scoped and cannot vary inside describe.
		test.use({
			viewport: descriptor.viewport,
			userAgent: descriptor.userAgent,
			deviceScaleFactor: descriptor.deviceScaleFactor,
			isMobile: descriptor.isMobile,
			hasTouch: descriptor.hasTouch,
		});
		for (const route of ["/", "/929/567", "/929/1", "/929/686"]) {
			test(route, async ({ page }, testInfo) =>
				testWebVitals({ page }, testInfo, device),
			);
		}
	});
}
