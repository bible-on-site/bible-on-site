import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { reportBenchmark } from "../util/benchmark";

/**
 * Performance regression test: rapid page flips in the sefer (FlipBook) view.
 *
 * The `/dev/sefer/{id}` route renders the FlipBook in isolation (no SEO
 * content, no layout wrappers).  The `/929/{id}?book` route renders the
 * same FlipBook inside the full page layout with heavy SEO DOM underneath.
 *
 * If the 929 route is significantly slower than the dev route we have a
 * performance regression — the surrounding DOM is interfering with flip
 * animation performance.
 *
 * The test clicks the "next page" button N times in quick succession and
 * measures the wall-clock time for the batch.
 */

const PEREK_ID = 125; // Bamidbar 8 — mid-size sefer
const FLIPS = 6; // number of rapid forward-flips per run
const RUNS = 3; // repeat to reduce noise
/** Maximum allowed ratio of 929-time / dev-time before we flag a regression. */
const MAX_RATIO = 1.35;

/** Wait for the FlipBook toolbar to appear (signals the book has mounted). */
async function waitForFlipBook(page: Page): Promise<void> {
	await page.waitForSelector(".flipbook-toolbar", { timeout: 30_000 });
	// Extra settle time for leaves-buffer rendering
	await page.waitForTimeout(1_000);
}

/**
 * Click "next page" `n` times as fast as possible and return the elapsed ms.
 * Uses the toolbar's "next" button which has a stable aria-label.
 */
async function rapidFlips(page: Page, n: number): Promise<number> {
	const nextBtn = page.locator("button.flipbook-toolbar-next");
	await expect(nextBtn).toBeVisible({ timeout: 5_000 });

	const start = Date.now();
	for (let i = 0; i < n; i++) {
		await nextBtn.click();
		// Small pause so the flip animation begins — without this the clicks
		// may coalesce into a single event.
		await page.waitForTimeout(120);
	}
	// Wait for the last animation to finish (flip animations are ~400ms)
	await page.waitForTimeout(600);
	return Date.now() - start;
}

/** Average of an array, ignoring the best and worst if length > 2. */
function trimmedMean(values: number[]): number {
	if (values.length <= 2) {
		return values.reduce((a, b) => a + b, 0) / values.length;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const trimmed = sorted.slice(1, -1);
	return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

test.describe("Sefer flip performance", () => {
	// Sefer view requires tablet+ viewport
	test.beforeEach(async ({ page }) => {
		const vp = page.viewportSize();
		test.skip(
			(vp?.width ?? 0) < 768,
			"Sefer view requires tablet+ viewport",
		);
	});

	test("929 route flips must not be significantly slower than dev route", async ({
		page,
	}) => {
		// ── Measure dev route (baseline) ──────────────────────────────
		const devTimes: number[] = [];
		for (let run = 0; run < RUNS; run++) {
			await page.goto(`http://localhost:3001/dev/sefer/${PEREK_ID}`, {
				waitUntil: "networkidle",
			});
			await waitForFlipBook(page);
			devTimes.push(await rapidFlips(page, FLIPS));
		}
		const devAvg = trimmedMean(devTimes);

		// ── Measure 929 route ─────────────────────────────────────────
		const seoTimes: number[] = [];
		for (let run = 0; run < RUNS; run++) {
			await page.goto(
				`http://localhost:3001/929/${PEREK_ID}?book`,
				{ waitUntil: "networkidle" },
			);
			await waitForFlipBook(page);
			seoTimes.push(await rapidFlips(page, FLIPS));
		}
		const seoAvg = trimmedMean(seoTimes);

		const ratio = seoAvg / devAvg;

		// Report benchmarks
		reportBenchmark({
			name: "sefer-flip/dev-route",
			measure: "time_ms",
			value: devAvg,
		});
		reportBenchmark({
			name: "sefer-flip/929-route",
			measure: "time_ms",
			value: seoAvg,
		});
		reportBenchmark({
			name: "sefer-flip/929-vs-dev-ratio",
			measure: "ratio",
			value: ratio,
			upperValue: MAX_RATIO,
		});

		console.log(
			`\n📊 Flip perf — dev: ${devAvg.toFixed(0)}ms | 929: ${seoAvg.toFixed(0)}ms | ratio: ${ratio.toFixed(2)}x\n`,
		);

		expect(
			ratio,
			`929 route is ${ratio.toFixed(2)}x slower than dev route (threshold: ${MAX_RATIO}x). ` +
				`dev=${devAvg.toFixed(0)}ms, 929=${seoAvg.toFixed(0)}ms`,
		).toBeLessThanOrEqual(MAX_RATIO);
	});
});
