import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import getPort from "get-port";
import lighthouse, { desktopConfig, type Flags, type Result } from "lighthouse";
import { reportBenchmark } from "../util/playwright/benchmark-reporter";
import { test as base, expect } from "../util/playwright/test-fixture";

type DeviceStrategy = "mobile" | "desktop";

/**
 * Extended test fixture that launches Chromium with remote debugging port.
 * This approach is based on playwright-lighthouse pattern:
 * - Each worker gets a unique port via get-port
 * - Chromium is launched with --remote-debugging-port
 * - Lighthouse connects via CDP to that port
 * - This ensures proper isolation between workers on CI
 *
 * The lighthouseResults fixture is worker-scoped and runs all Lighthouse audits
 * once per worker, storing results for use by individual test assertions.
 */

// Test configuration
const TEST_PAGES = ["/", "/929/686"];
const STRATEGIES: DeviceStrategy[] = ["mobile", "desktop"];

type ResultKey = `${string}-${DeviceStrategy}`;
type LighthouseResultsMap = Map<ResultKey, Result>;

function getResultKey(path: string, strategy: DeviceStrategy): ResultKey {
	return `${path}-${strategy}`;
}

const test = base.extend<
	{ getLighthouseResult: (path: string, strategy: DeviceStrategy) => Result },
	{ lighthousePort: number; lighthouseResults: LighthouseResultsMap }
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

	// Worker-scoped: run all Lighthouse audits once and store results
	lighthouseResults: [
		async ({ lighthousePort }, use) => {
			const results: LighthouseResultsMap = new Map();

			// Launch browser once for all audits
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

			try {
				// Run all Lighthouse audits
				for (const path of TEST_PAGES) {
					for (const strategy of STRATEGIES) {
						const page = await context.newPage();
						const url = `${BASE_URL}${path}`;

						// Warm up the page
						await page.goto(url, { waitUntil: "networkidle" });
						await page.close();

						// Run Lighthouse
						const lhr = await runLighthouseAudit(url, strategy, lighthousePort);
						saveReport(lhr, strategy, path);
						results.set(getResultKey(path, strategy), lhr);
					}
				}
			} finally {
				await context.close();
			}

			await use(results);
			results.clear();
		},
		{ scope: "worker" },
	],

	// Test-scoped: accessor function for getting results
	getLighthouseResult: async ({ lighthouseResults }, use) => {
		await use((path: string, strategy: DeviceStrategy) => {
			const result = lighthouseResults.get(getResultKey(path, strategy));
			if (!result) {
				throw new Error(
					`Lighthouse results not available for ${path} (${strategy})`,
				);
			}
			return result;
		});
	},
});

test.describe.configure({ mode: "serial" });

/**
 * Lighthouse scoreDisplayMode values that indicate the audit has a measurable score.
 * These are the only audits we should assert against.
 *
 * @see https://github.com/GoogleChrome/lighthouse/blob/main/types/lhr/audit-result.d.ts
 *
 * Measurable modes:
 * - 'numeric': Scores of 0-1 (map to displayed scores of 0-100)
 * - 'binary': Pass/fail audit (0 and 1 are only possible scores)
 * - 'metricSavings': Score determined by metric savings and product score
 *
 * Non-measurable modes (score is null, should be ignored):
 * - 'manual': Exists only to tell you to review something yourself
 * - 'informative': FYI only, can't be interpreted as pass/fail
 * - 'notApplicable': Audit doesn't apply to the page
 * - 'error': Error while running the audit
 */
const MEASURABLE_SCORE_DISPLAY_MODES = [
	"numeric",
	"binary",
	"metricSavings",
] as const;
type MeasurableScoreDisplayMode =
	(typeof MEASURABLE_SCORE_DISPLAY_MODES)[number];

function isMeasurableAudit(
	scoreDisplayMode: string,
): scoreDisplayMode is MeasurableScoreDisplayMode {
	return MEASURABLE_SCORE_DISPLAY_MODES.includes(
		scoreDisplayMode as MeasurableScoreDisplayMode,
	);
}

/**
 * Known issues configuration loaded from YAML files.
 * Each file in tests/perf/known-issues/lighthouse/ represents a known failing audit.
 */
interface KnownIssue {
	id: string;
	strategy: "all" | "mobile" | "desktop";
	explanation: string;
}

/**
 * Parse a simple YAML file (key: value format with multiline support)
 */
function parseSimpleYaml(content: string): Record<string, string> {
	const result: Record<string, string> = {};
	const lines = content.split(/\r?\n/);
	let currentKey: string | null = null;
	let currentValue: string[] = [];

	for (const line of lines) {
		// Skip comments and empty lines
		const trimmed = line.trim();
		if (trimmed.startsWith("#") || trimmed === "") continue;

		// Check for key: value or key: | (multiline)
		const keyMatch = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.*)$/);
		if (keyMatch) {
			// Save previous key-value if exists
			if (currentKey) {
				result[currentKey] = currentValue.join("\n").trim();
			}
			currentKey = keyMatch[1];
			const value = keyMatch[2].trim();
			if (value === "|") {
				// Multiline value
				currentValue = [];
			} else {
				currentValue = [value];
			}
		} else if (currentKey && line.startsWith("  ")) {
			// Continuation of multiline value
			currentValue.push(line.slice(2));
		}
	}

	// Save last key-value
	if (currentKey) {
		result[currentKey] = currentValue.join("\n").trim();
	}

	return result;
}

/**
 * Load known issues from YAML files in the known-issues/lighthouse directory.
 * Each YAML file should have 'id', 'strategy', and 'explanation' fields.
 */
function loadKnownIssues(): Map<string, KnownIssue> {
	const knownIssuesDir = resolve(__dirname, "known-issues", "lighthouse");
	const knownIssues = new Map<string, KnownIssue>();

	try {
		const files = readdirSync(knownIssuesDir).filter(
			(f) => f.endsWith(".yml") || f.endsWith(".yaml"),
		);

		for (const file of files) {
			const filePath = resolve(knownIssuesDir, file);
			const content = readFileSync(filePath, "utf-8");
			const parsed = parseSimpleYaml(content);

			if (parsed.id && parsed.strategy && parsed.explanation) {
				const strategy = parsed.strategy as KnownIssue["strategy"];
				if (!["all", "mobile", "desktop"].includes(strategy)) {
					console.warn(
						`Warning: Invalid strategy '${strategy}' in ${file}. Expected 'all', 'mobile', or 'desktop'.`,
					);
					continue;
				}
				knownIssues.set(parsed.id, {
					id: parsed.id,
					strategy,
					explanation: parsed.explanation,
				});
			} else {
				console.warn(
					`Warning: Invalid YAML in ${file}: missing 'id', 'strategy', or 'explanation' field. Parsed: ${JSON.stringify(parsed)}`,
				);
			}
		}
	} catch (error) {
		console.warn(
			`Warning: Could not load known issues from ${knownIssuesDir}: ${error}`,
		);
	}

	return knownIssues;
}

// Load known issues at module load time
const KNOWN_ISSUES = loadKnownIssues();

function isKnownIssue(auditId: string, strategy: DeviceStrategy): boolean {
	const issue = KNOWN_ISSUES.get(auditId);
	if (!issue) return false;
	return issue.strategy === "all" || issue.strategy === strategy;
}

/**
 * Maps Lighthouse numericUnit to a unified Bencher measure name.
 * Grouping by scale prevents sparse matrices in Bencher reports.
 */
function getBencherMeasure(
	numericUnit: string | undefined,
): "time_ms" | "bytes" | "count" | "score" {
	switch (numericUnit) {
		case "millisecond":
			return "time_ms";
		case "byte":
			return "bytes";
		case "element":
			return "count";
		default:
			// unitless, undefined, or any other unit → use score (0-1)
			return "score";
	}
}

/**
 * Extract diagnostic details from a Lighthouse audit result.
 * This provides actionable information about what's failing and why.
 */
function getAuditDiagnostics(audit: Result["audits"][string]): string {
	const parts: string[] = [];

	// Add display value if present (e.g., "3.2 s", "2 resources")
	if (audit.displayValue) {
		parts.push(`Value: ${audit.displayValue}`);
	}

	// Add explanation if present
	if (audit.explanation) {
		parts.push(`Explanation: ${audit.explanation}`);
	}

	// Extract details based on type
	if (audit.details) {
		const details = audit.details as Record<string, unknown>;

		// Table type - common for many audits
		if (details.type === "table" && Array.isArray(details.items)) {
			const items = details.items as Record<string, unknown>[];
			const maxItems = 5;
			const displayItems = items.slice(0, maxItems);

			parts.push(`Failing elements (${items.length} total):`);
			for (const item of displayItems) {
				const itemLines: string[] = [];

				// Extract node details (accessibility audits)
				if (item.node && typeof item.node === "object") {
					const node = item.node as Record<string, unknown>;
					if (node.snippet) itemLines.push(`Element: ${node.snippet}`);
					if (node.nodeLabel) itemLines.push(`Content: ${node.nodeLabel}`);
					if (node.selector) itemLines.push(`Selector: ${node.selector}`);
					if (node.explanation) itemLines.push(`Issue: ${node.explanation}`);
				}

				// Extract URL (performance audits)
				if (item.url) itemLines.push(`URL: ${item.url}`);
				if (item.source) {
					const source = item.source as Record<string, unknown>;
					if (source.url) itemLines.push(`Source: ${source.url}`);
				}

				// Extract sub-items with related nodes
				if (item.subItems && typeof item.subItems === "object") {
					const subItems = item.subItems as {
						items?: Record<string, unknown>[];
					};
					if (Array.isArray(subItems.items)) {
						for (const subItem of subItems.items) {
							if (
								subItem.relatedNode &&
								typeof subItem.relatedNode === "object"
							) {
								const relNode = subItem.relatedNode as Record<string, unknown>;
								if (relNode.snippet) {
									itemLines.push(`Related element: ${relNode.snippet}`);
								}
								if (relNode.nodeLabel) {
									itemLines.push(`Related content: ${relNode.nodeLabel}`);
								}
							}
						}
					}
				}

				// For non-node items (generic key-value)
				if (item.node === undefined && itemLines.length === 0) {
					const snippet = Object.entries(item)
						.filter(([, v]) => v && typeof v !== "object")
						.map(([key, v]) => `${key}: ${v}`)
						.join(", ");
					if (snippet) itemLines.push(snippet);
				}

				if (itemLines.length > 0) {
					parts.push(`  - ${itemLines.join("\n    ")}`);
				}
			}

			if (items.length > maxItems) {
				parts.push(`  ... and ${items.length - maxItems} more`);
			}
		}

		// Opportunity type - common for performance audits
		if (details.type === "opportunity" && Array.isArray(details.items)) {
			const items = details.items as Record<string, unknown>[];
			parts.push(`Opportunities (${items.length} total):`);
			for (const item of items.slice(0, 3)) {
				if (item.url && item.wastedBytes) {
					parts.push(
						`  - ${item.url}: ${Math.round(Number(item.wastedBytes) / 1024)} KiB wasted`,
					);
				}
			}
		}

		// Debugdata type
		if (details.type === "debugdata") {
			parts.push("Debug data available in full report");
		}
	}

	return parts.length > 0 ? parts.join("\n") : "No additional diagnostics";
}

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
	// Report saved silently - path available in .lighthouse-reports directory
}

test.describe("Lighthouse", () => {
	// Set longer timeout for Lighthouse audits (includes fixture setup time)
	test.setTimeout(180_000);

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
					test(`category: ${categoryId}`, async ({
						getLighthouseResult,
					}, testInfo) => {
						const lhr = getLighthouseResult(path, strategy);
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
					test(`metric: ${metric.name}`, async ({
						getLighthouseResult,
					}, testInfo) => {
						const lhr = getLighthouseResult(path, strategy);
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

				// Dynamic audit validation using soft assertions and test steps
				// Each audit gets its own step in the report for visibility,
				// and soft assertions allow all audits to be checked even if some fail
				test("audits: all measurable audits pass", async ({
					getLighthouseResult,
				}) => {
					const lhr = getLighthouseResult(path, strategy);

					const summary = {
						passed: 0,
						skipped: 0,
						knownFailing: 0,
						failed: 0,
					};

					// Iterate over all audits in the Lighthouse results
					for (const [auditId, audit] of Object.entries(lhr.audits)) {
						// Skip audits that are not measurable (manual, informative, notApplicable, error)
						if (!isMeasurableAudit(audit.scoreDisplayMode)) {
							summary.skipped++;
							continue;
						}

						// For measurable audits, score should not be null
						const score = audit.score;
						if (score === null) {
							summary.skipped++;
							continue;
						}

						// Report to Bencher using unified measure names based on numericUnit.
						// This groups audits by scale (time_ms, bytes, count, score) to prevent
						// sparse matrices in Bencher reports.
						const measure = getBencherMeasure(audit.numericUnit);
						const benchmarkValue =
							audit.numericValue !== undefined ? audit.numericValue : score;
						reportBenchmark({
							name: `audit: ${auditId}`,
							measure,
							value: benchmarkValue,
						});

						// Use test.step for per-audit visibility in the report
						await test.step(`audit: ${auditId}`, async () => {
							const scorePercent = (score * 100).toFixed(0);

							if (score >= 0.9) {
								summary.passed++;
								return; // Passed
							}

							// Get diagnostics for any failing audit
							const diagnostics = getAuditDiagnostics(audit);

							if (isKnownIssue(auditId, strategy)) {
								// Known failing - count but don't log (diagnostics are in YAML files)
								summary.knownFailing++;
								return; // Known issue - don't fail the test
							}

							// Unexpected failure - log full diagnostics and use soft assertion
							summary.failed++;
							console.error(
								`  ✗ [FAILURE] ${auditId}: ${scorePercent}% - ${audit.title}`,
							);
							if (audit.description) {
								console.error(`    Description: ${audit.description}`);
							}
							if (diagnostics) {
								console.error(`    Diagnostics: ${diagnostics}`);
							}

							expect
								.soft(
									score,
									`Audit "${audit.title}" (${auditId}) score ${scorePercent}% should be >= 90%`,
								)
								.toBeGreaterThanOrEqual(0.9);
						});
					}

					// Log summary for debugging
					console.log(`\nAudit Summary for ${path} (${strategy}):`);
					console.log(`  ✓ Passed: ${summary.passed}`);
					console.log(`  ○ Skipped (non-measurable): ${summary.skipped}`);
					console.log(`  ⚠ Known issues: ${summary.knownFailing}`);
					console.log(`  ✗ Failed: ${summary.failed}`);
				});
			});
		}
	}
});
