import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type BrowserContext, chromium } from "@playwright/test";
import getPort from "get-port";
import lighthouse, { desktopConfig, type Flags, type Result } from "lighthouse";
import { reportBenchmark } from "../util/playwright/benchmark-reporter";
import { test as base, expect } from "../util/playwright/test-fixture";

/**
 * Extended test fixture that launches Chromium with remote debugging port.
 * This approach is based on playwright-lighthouse pattern:
 * - Each worker gets a unique port via get-port
 * - Chromium is launched with --remote-debugging-port
 * - Lighthouse connects via CDP to that port
 * - This ensures proper isolation between workers on CI
 */
const test = base.extend<
	{ context: BrowserContext },
	{ lighthousePort: number }
>({
	// Worker-scoped: each parallel worker gets a unique port
	lighthousePort: [
		// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern requires destructuring
		async ({}, use) => {
			const port = await getPort();
			await use(port);
		},
		{ scope: "worker" },
	],

	// Test-scoped: launch Chromium with remote debugging port
	context: [
		async ({ lighthousePort }, use) => {
			const context = await chromium.launchPersistentContext(
				"", // Empty string = temp user data dir
				{
					args: [
						`--remote-debugging-port=${lighthousePort}`,
						"--no-sandbox",
						"--disable-gpu",
					],
					headless: true,
				},
			);
			await use(context);
			await context.close();
		},
		{ scope: "test" },
	],
});

test.describe.configure({ mode: "serial" });

type DeviceStrategy = "mobile" | "desktop";

/**
 * Audit configuration: defines which audits to check and their expected scores
 * score: null means the audit is informational (not scored)
 * score: 1 means the audit should pass (score >= 0.9)
 * score: 0 means the audit is expected to fail (we track it but don't assert)
 */
interface AuditExpectation {
	id: string;
	description: string;
	expectedScore: number | null; // null = informational, 1 = should pass, 0 = known failure
	category: "performance" | "accessibility" | "best-practices" | "seo";
}

/**
 * All audits from PageSpeed Insights report (Dec 28, 2025)
 * Organized by category with expected scores
 */
const AUDITS: AuditExpectation[] = [
	// ===== PERFORMANCE CATEGORY =====
	// Core Web Vitals - tested separately via metric values, so mark as informational here
	{
		id: "first-contentful-paint",
		description: "First Contentful Paint",
		expectedScore: null, // Tested via metric value threshold
		category: "performance",
	},
	{
		id: "largest-contentful-paint",
		description: "Largest Contentful Paint",
		expectedScore: null, // Tested via metric value threshold
		category: "performance",
	},
	{
		id: "total-blocking-time",
		description: "Total Blocking Time",
		expectedScore: null, // Tested via metric value threshold
		category: "performance",
	},
	{
		id: "cumulative-layout-shift",
		description: "Cumulative Layout Shift",
		expectedScore: null, // Tested via metric value threshold
		category: "performance",
	},
	{
		id: "speed-index",
		description: "Speed Index",
		expectedScore: null, // Tested via metric value threshold
		category: "performance",
	},

	// Performance Diagnostics (Insights section)
	{
		id: "render-blocking-resources",
		description: "Render blocking resources",
		expectedScore: null,
		category: "performance",
	},
	{
		id: "legacy-javascript",
		description: "Legacy JavaScript (polyfills)",
		expectedScore: null,
		category: "performance",
	},
	{
		id: "critical-request-chains",
		description: "Network dependency tree / critical request chains",
		expectedScore: null,
		category: "performance",
	},
	{
		id: "layout-shifts",
		description: "Layout shift culprits",
		expectedScore: null,
		category: "performance",
	},
	{
		id: "lcp-lazy-loaded",
		description: "LCP request discovery (avoid lazy-loading LCP)",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "unused-javascript",
		description: "Reduce unused JavaScript",
		expectedScore: null,
		category: "performance",
	},
	{
		id: "long-tasks",
		description: "Avoid long main-thread tasks",
		expectedScore: null,
		category: "performance",
	},

	// Performance Passed Audits
	{
		id: "uses-long-cache-ttl",
		description: "Use efficient cache lifetimes",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "redirects",
		description: "Avoids redirects",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "server-response-time",
		description: "Server responds quickly (TTFB)",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "uses-text-compression",
		description: "Applies text compression",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "dom-size",
		description: "Optimize DOM size",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "duplicated-javascript",
		description: "No duplicated JavaScript",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "font-display",
		description: "Font display (swap or optional)",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "no-forced-reflow",
		description: "No forced reflow",
		expectedScore: null,
		category: "performance",
	},
	{
		id: "uses-responsive-images",
		description: "Improve image delivery",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "viewport",
		description: "Optimize viewport for mobile",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "unminified-css",
		description: "Minify CSS",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "unminified-javascript",
		description: "Minify JavaScript",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "unused-css-rules",
		description: "Reduce unused CSS",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "total-byte-weight",
		description: "Avoids enormous network payloads",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "user-timings",
		description: "User Timing marks and measures",
		expectedScore: null,
		category: "performance",
	},
	{
		id: "bootup-time",
		description: "JavaScript execution time",
		expectedScore: null, // Volatile in local testing
		category: "performance",
	},
	{
		id: "mainthread-work-breakdown",
		description: "Minimizes main-thread work",
		expectedScore: null, // Volatile in local testing
		category: "performance",
	},
	{
		id: "non-composited-animations",
		description: "Avoid non-composited animations",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "unsized-images",
		description: "Image elements have explicit width and height",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "uses-optimized-images",
		description: "Efficiently encode images",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "offscreen-images",
		description: "Defer offscreen images",
		expectedScore: 1,
		category: "performance",
	},
	{
		id: "preconnect",
		description: "Preconnect to required origins",
		expectedScore: null,
		category: "performance",
	},
	{
		id: "third-party-summary",
		description: "3rd party code impact",
		expectedScore: null,
		category: "performance",
	},

	// ===== ACCESSIBILITY CATEGORY =====
	// Accessibility Failures (from report)
	{
		id: "list",
		description: "Lists contain only <li> elements",
		expectedScore: null, // Varies by page, track for awareness
		category: "accessibility",
	},
	{
		id: "landmark-one-main",
		description: "Document has a main landmark",
		expectedScore: null, // Varies by page, track for awareness
		category: "accessibility",
	},
	{
		id: "image-redundant-alt",
		description: "Image alt attributes not redundant",
		expectedScore: 1,
		category: "accessibility",
	},

	// Accessibility Passed Audits
	{
		id: "aria-allowed-attr",
		description: "[aria-*] attributes match their roles",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "aria-hidden-body",
		description: "[aria-hidden=true] not on document body",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "aria-required-attr",
		description: "[role]s have required [aria-*] attributes",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "aria-valid-attr-value",
		description: "[aria-*] attributes have valid values",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "aria-valid-attr",
		description: "[aria-*] attributes are valid and not misspelled",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "aria-roles",
		description: "[role] values are valid",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "image-alt",
		description: "Image elements have [alt] attributes",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "meta-viewport",
		description: "[user-scalable=no] not used, max-scale >= 5",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "aria-conditional-attr",
		description: "ARIA attributes used as specified for role",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "aria-prohibited-attr",
		description: "Elements use only permitted ARIA attributes",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "color-contrast",
		description: "Background/foreground colors have sufficient contrast",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "document-title",
		description: "Document has a <title> element",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "html-has-lang",
		description: "<html> element has a [lang] attribute",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "html-lang-valid",
		description: "<html> element has valid [lang] value",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "link-name",
		description: "Links have a discernible name",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "listitem",
		description: "List items contained within <ul>/<ol>/<menu>",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "target-size",
		description: "Touch targets have sufficient size/spacing",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "heading-order",
		description: "Headings appear in sequentially-descending order",
		expectedScore: 1,
		category: "accessibility",
	},
	{
		id: "aria-deprecated-role",
		description: "Deprecated ARIA roles not used",
		expectedScore: 1,
		category: "accessibility",
	},

	// ===== BEST PRACTICES CATEGORY =====
	// Trust and Safety (informational - unscored)
	{
		id: "csp-xss",
		description: "CSP effective against XSS attacks",
		expectedScore: null,
		category: "best-practices",
	},
	{
		id: "is-on-https",
		description: "Uses HTTPS",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "no-vulnerable-libraries",
		description: "No vulnerable libraries detected",
		expectedScore: 1,
		category: "best-practices",
	},

	// Best Practices Passed Audits
	{
		id: "deprecations",
		description: "Avoids deprecated APIs",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "third-party-cookies",
		description: "Avoids third-party cookies",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "paste-preventing-inputs",
		description: "Allows users to paste into input fields",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "geolocation-on-start",
		description: "Avoids requesting geolocation on page load",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "notification-on-start",
		description: "Avoids requesting notification permission on page load",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "image-aspect-ratio",
		description: "Displays images with correct aspect ratio",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "image-size-responsive",
		description: "Serves images with appropriate resolution",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "doctype",
		description: "Page has the HTML doctype",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "charset",
		description: "Properly defines charset",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "errors-in-console",
		description: "No browser errors logged to console",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "inspector-issues",
		description: "No issues in Chrome DevTools Issues panel",
		expectedScore: 1,
		category: "best-practices",
	},
	{
		id: "valid-source-maps",
		description: "Page has valid source maps",
		expectedScore: null,
		category: "best-practices",
	},

	// ===== SEO CATEGORY =====
	{
		id: "is-crawlable",
		description: "Page isn't blocked from indexing",
		expectedScore: 1,
		category: "seo",
	},
	{
		id: "meta-description",
		description: "Document has a meta description",
		expectedScore: 1,
		category: "seo",
	},
	{
		id: "http-status-code",
		description: "Page has successful HTTP status code",
		expectedScore: 1,
		category: "seo",
	},
	{
		id: "link-text",
		description: "Links have descriptive text",
		expectedScore: 1,
		category: "seo",
	},
	{
		id: "crawlable-anchors",
		description: "Links are crawlable",
		expectedScore: 1,
		category: "seo",
	},
	{
		id: "hreflang",
		description: "Document has a valid hreflang",
		expectedScore: 1,
		category: "seo",
	},
];

/**
 * Thresholds for Core Web Vitals metrics (in milliseconds, except CLS which is a score)
 */
interface MetricThresholds {
	fcp: number;
	lcp: number;
	tbt: number;
	cls: number;
	si: number;
}

const METRIC_THRESHOLDS: Record<DeviceStrategy, MetricThresholds> = {
	mobile: {
		fcp: 4000, // Allow up to 4s for local testing
		lcp: 6000, // Allow up to 6s for local testing
		tbt: 10000, // Local testing can have high blocking time
		cls: 0.25, // "Good" threshold: 0.1, allow 0.25 for local
		si: 8000, // Allow up to 8s for local
	},
	desktop: {
		fcp: 3000, // Allow up to 3s
		lcp: 5000, // Allow up to 5s
		tbt: 5000, // Allow up to 5s for local testing
		cls: 0.25, // Allow 0.25 for local
		si: 5000, // Allow up to 5s
	},
};

/**
 * Category score thresholds (0-1 scale)
 */
const CATEGORY_THRESHOLDS: Record<DeviceStrategy, Record<string, number>> = {
	mobile: {
		performance: 0.5, // Mobile performance varies significantly in local testing
		accessibility: 0.85, // Allow some variance for known issues
		"best-practices": 1.0,
		seo: 1.0,
	},
	desktop: {
		performance: 0.7, // Desktop should be better but local testing varies
		accessibility: 0.85,
		"best-practices": 1.0,
		seo: 1.0,
	},
};

// Use local dev server URL
const BASE_URL = "http://127.0.0.1:3001";

/**
 * Run Lighthouse audit using the Playwright-managed Chrome instance.
 * This connects to the browser's remote debugging port instead of launching a separate Chrome.
 */
async function runLighthouseAudit(
	url: string,
	strategy: DeviceStrategy,
	port: number,
): Promise<Result> {
	const flags: Flags = {
		logLevel: "error",
		output: "json",
		onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
		port,
		// Don't reset storage since we're using Playwright's context
		disableStorageReset: true,
	};

	// Use desktop config for desktop strategy
	const config = strategy === "desktop" ? desktopConfig : undefined;

	const runnerResult = await lighthouse(url, flags, config);

	if (!runnerResult?.lhr) {
		throw new Error("Lighthouse audit failed - no result returned");
	}

	return runnerResult.lhr;
}

function saveReport(lhr: Result, strategy: DeviceStrategy, path: string) {
	const reportsDir = resolve(__dirname, "../../.lighthouse-reports");
	mkdirSync(reportsDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const safePath = path.replace(/\//g, "_");
	const reportPath = resolve(
		reportsDir,
		`${strategy}${safePath}-${timestamp}.json`,
	);
	writeFileSync(reportPath, JSON.stringify(lhr, null, 2));

	console.log(`Lighthouse report saved to: ${reportPath}`);
}

// Store Lighthouse results for independent test assertions
type ResultKey = `${string}-${DeviceStrategy}`;
const lighthouseResults = new Map<ResultKey, Result>();

function getResultKey(path: string, strategy: DeviceStrategy): ResultKey {
	return `${path}-${strategy}`;
}

// Test configuration
const TEST_PAGES = ["/", "/929/686"];
const STRATEGIES: DeviceStrategy[] = ["mobile", "desktop"];

test.describe("Lighthouse", () => {
	// Set longer timeout for Lighthouse audits
	test.setTimeout(180_000);

	test.afterAll(async () => {
		lighthouseResults.clear();
	});

	// Run Lighthouse audits as "setup" tests - one per page/strategy
	// This ensures we use Playwright's browser context with proper port isolation
	for (const path of TEST_PAGES) {
		for (const strategy of STRATEGIES) {
			test(`[setup] run audit: ${path} (${strategy})`, async ({
				context,
				lighthousePort,
			}) => {
				// Open the page first to ensure browser is warmed up
				const page = await context.newPage();
				const url = `${BASE_URL}${path}`;
				await page.goto(url, { waitUntil: "networkidle" });
				await page.close();

				// Run Lighthouse against the browser's remote debugging port
				console.log(
					`Running Lighthouse for ${url} (${strategy}) on port ${lighthousePort}...`,
				);
				const lhr = await runLighthouseAudit(url, strategy, lighthousePort);
				saveReport(lhr, strategy, path);
				lighthouseResults.set(getResultKey(path, strategy), lhr);

				// Basic sanity check - ensure we got results
				expect(lhr.categories.performance).toBeDefined();
			});
		}
	}

	// Generate tests for each page/strategy combination
	for (const path of TEST_PAGES) {
		for (const strategy of STRATEGIES) {
			const testPrefix = `${path} (${strategy})`;

			test.describe(testPrefix, () => {
				// Category score tests
				const categoryThresholds = CATEGORY_THRESHOLDS[strategy];
				for (const [categoryId, minScore] of Object.entries(
					categoryThresholds,
				)) {
					// biome-ignore lint/correctness/noEmptyPattern: Playwright test fixture pattern requires destructuring
					test(`category: ${categoryId}`, async ({}, testInfo) => {
						const lhr = lighthouseResults.get(getResultKey(path, strategy));
						if (!lhr) {
							throw new Error(
								`Lighthouse results not available for ${path} (${strategy})`,
							);
						}
						const category =
							lhr.categories[categoryId as keyof typeof lhr.categories];
						const score = category?.score ?? 0;

						reportBenchmark({
							name: testInfo.title,
							measure: `category-${categoryId}`,
							value: score,
							lowerValue: minScore,
							upperValue: 1.0,
						});

						expect(
							score,
							`${categoryId} score ${(score * 100).toFixed(0)}% should be >= ${(minScore * 100).toFixed(0)}%`,
						).toBeGreaterThanOrEqual(minScore);
					});
				}

				// Core Web Vitals metric tests
				const metricThresholds = METRIC_THRESHOLDS[strategy];
				const coreMetrics = [
					{
						id: "first-contentful-paint",
						name: "FCP",
						threshold: metricThresholds.fcp,
					},
					{
						id: "largest-contentful-paint",
						name: "LCP",
						threshold: metricThresholds.lcp,
					},
					{
						id: "total-blocking-time",
						name: "TBT",
						threshold: metricThresholds.tbt,
					},
					{
						id: "cumulative-layout-shift",
						name: "CLS",
						threshold: metricThresholds.cls,
					},
					{ id: "speed-index", name: "SI", threshold: metricThresholds.si },
				];

				for (const metric of coreMetrics) {
					// biome-ignore lint/correctness/noEmptyPattern: Playwright test fixture pattern requires destructuring
					test(`metric: ${metric.name}`, async ({}, testInfo) => {
						const lhr = lighthouseResults.get(getResultKey(path, strategy));
						if (!lhr) {
							throw new Error(
								`Lighthouse results not available for ${path} (${strategy})`,
							);
						}
						const audit = lhr.audits[metric.id];
						const value = audit?.numericValue ?? 0;

						reportBenchmark({
							name: testInfo.title,
							measure: `metric-${metric.name.toLowerCase()}`,
							value: value,
							upperValue: metric.threshold,
						});

						expect(
							value,
							`${metric.name} value ${value} should be <= ${metric.threshold}`,
						).toBeLessThanOrEqual(metric.threshold);
					});
				}

				// Individual audit tests
				for (const auditExpectation of AUDITS) {
					// biome-ignore lint/correctness/noEmptyPattern: Playwright test fixture pattern requires destructuring
					test(`audit: ${auditExpectation.id}`, async ({}, testInfo) => {
						const lhr = lighthouseResults.get(getResultKey(path, strategy));
						if (!lhr) {
							throw new Error(
								`Lighthouse results not available for ${path} (${strategy})`,
							);
						}
						const audit = lhr.audits[auditExpectation.id];

						// Skip if audit doesn't exist in results
						if (!audit) {
							test.skip();
							return;
						}

						const score = audit.score;
						const numericValue = audit.numericValue;

						// Report benchmark for every audit
						const benchmarkValue = numericValue ?? score ?? 0;
						reportBenchmark({
							name: testInfo.title,
							measure: `audit-${auditExpectation.id}`,
							value: benchmarkValue,
							lowerValue:
								auditExpectation.expectedScore === null
									? undefined
									: auditExpectation.expectedScore === 0
										? 0
										: 0.9,
							upperValue:
								auditExpectation.expectedScore === null ? undefined : 1.0,
						});

						// Assert based on expectedScore
						if (auditExpectation.expectedScore === null) {
							// Informational audit - no assertion, just reporting
							return;
						}

						if (score === null) {
							// Not applicable - skip assertion
							return;
						}

						if (auditExpectation.expectedScore === 0) {
							// Known failure - assert it IS failing (score < 0.9)
							expect(
								score,
								`Audit "${auditExpectation.description}" is marked as known failure but passed with score ${(score * 100).toFixed(0)}%`,
							).toBeLessThan(0.9);
						} else {
							// Expected to pass - assert score >= 0.9
							expect(
								score,
								`Audit "${auditExpectation.description}" score ${(score * 100).toFixed(0)}% should be >= 90%`,
							).toBeGreaterThanOrEqual(0.9);
						}
					});
				}
			});
		}
	}
});
