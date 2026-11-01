import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	reportBenchmark,
	reportFrameBlockingBenchmark,
} from "../util/benchmark";
import { type FrameMetrics, reduceFrameSamples } from "../util/frame-metrics";

/**
 * Performance regression test: rapid page flips in the sefer (FlipBook) view.
 *
 * The `/dev/sefer/{id}` route renders the FlipBook in isolation (no SEO
 * content, no layout wrappers).  The `/929/{id}?book` route renders the
 * same FlipBook inside the full page layout with heavy SEO DOM underneath.
 *
 * Two regression classes are guarded:
 *
 * 1. 929-only slowdown — the surrounding DOM interfering with flip
 *    animation.  Caught by the paired dev/929 ratio.
 * 2. Common-mode slowdown — work inside the shared reader path (e.g. the
 *    #2805 regression, where every committed flip rebuilt the whole
 *    ~30k-element page tree and stalled the main thread).  A ratio
 *    cannot see it, so each route is also checked against an absolute
 *    frame-blocked budget.
 *
 * Frame quality is measured with a requestAnimationFrame gap probe plus a
 * longtask observer injected into the page: a flip that drops frames
 * shows up as gaps beyond one animation frame, and synchronous main-thread
 * work shows up as longtasks.  The bound is generous — CI runners vary —
 * so it trips on catastrophic regressions. Bencher records the fraction of
 * that same calibrated frame budget; raw milliseconds remain in the log.
 *
 * Click and drag workloads run as separate tests so each stays inside
 * the suite deadline, which itself remains a regression check.
 */

const PEREK_ID = 125; // Bamidbar 8 — mid-size sefer
const FLIPS = 6; // number of rapid forward-flips per run
const DRAGS = 2; // pointer drag-turns per run
/**
 * Repeat runs to reduce noise.  Each run reloads both routes (~3s each),
 * so the local 20s-per-test deadline only fits two runs; CI's 60s
 * deadline keeps three.  Min-of-runs still isolates the least-contended
 * batch in both cases.
 */
const RUNS = process.env.CI ? 3 : 2;
/** Maximum allowed ratio of 929-time / dev-time before we flag a regression. */
const MAX_RATIO = 1.35;

/** A frame gap above this counts toward blocked time (≈2 dropped frames @60fps). */
const FRAME_GAP_BUDGET_MS = 33.4;
/**
 * Main-thread budget for one flip batch (FLIPS flips + settle), scaled by
 * the machine's measured CPU speed and asserted on the least-contended
 * run.  Longtask time is the discriminating metric: the #2805 regression
 * spent ~2s per batch in >50ms tasks where the healthy path spends
 * ~0.4s (~5.7x), a gap wider than shared-CPU hardware variance.  The
 * frame-blocked bound stays generous — software-rasterized CI inflates
 * rAF gaps regardless of main-thread health. Bencher uses that same bound;
 * a percentage of near-zero historical blocking would flag ordinary frames.
 */
const MAX_BLOCKED_MS_PER_BATCH = 8_000;
const MAX_LONGTASK_MS_PER_BATCH = 1_500;
/** Calibration spin size and the reference duration on the machine this
 * suite was tuned on (≈17–33ms in headless Chromium here). */
const CALIBRATION_ITERATIONS = 2_000_000;
const CALIBRATION_REFERENCE_MS = 18;

declare global {
	interface Window {
		__flipProbe?: {
			frames: number[];
			longtaskMs: number;
			raf: number;
			observer: PerformanceObserver | null;
		};
	}
}

/**
 * Relative CPU-speed factor: a fixed arithmetic spin measured on this
 * testbed vs the reference duration.  Shared-CPU CI runners are slower
 * than the calibrated machine, so absolute frame budgets scale by this
 * factor instead of assuming a fixed testbed speed.
 */
async function cpuSpeedFactor(page: Page): Promise<number> {
	const ms = await page.evaluate((iterations) => {
		const start = performance.now();
		let x = 0;
		for (let i = 0; i < iterations; i++) x += Math.sqrt(i * 1.000001);
		// `x` must escape so the loop is not optimized away.
		return x < 0 ? -1 : performance.now() - start;
	}, CALIBRATION_ITERATIONS);
	if (ms <= 0) return 1;
	return Math.max(0.5, ms / CALIBRATION_REFERENCE_MS);
}

/** Wait for the initialized spread and navigation controls to reach the screen. */
async function waitForFlipBook(page: Page): Promise<void> {
	await page.waitForFunction(() => {
		const next = document.querySelector<HTMLButtonElement>(
			"button.flipbook-toolbar-next",
		);
		if (!next || next.disabled) return false;
		const controls = next.getBoundingClientRect();
		if (controls.width <= 0 || controls.height <= 0) return false;
		const pages = document.querySelectorAll(".he-book .page.current-page");
		return (
			pages.length === 2 &&
			[...pages].every((page) => {
				const bounds = page.getBoundingClientRect();
				return bounds.width > 40 && bounds.height > 40;
			}) &&
			!document.querySelector(".he-book .page--flipping")
		);
	});
	// Two animation frames give the initialized geometry a paint opportunity;
	// there is no fixed settling delay once the real reader is ready.
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			}),
	);
}

/**
 * Install a fresh rAF-gap + longtask probe on the page.  Any live probe
 * is cancelled first so instrumentation never overlaps a measurement
 * window; stale callbacks also self-terminate on the identity check.
 */
async function startFrameProbe(page: Page): Promise<void> {
	await page.evaluate(() => {
		if (window.__flipProbe) {
			cancelAnimationFrame(window.__flipProbe.raf);
			window.__flipProbe.observer?.disconnect();
		}
		const probe = {
			frames: [] as number[],
			longtaskMs: 0,
			raf: 0,
			observer: null as PerformanceObserver | null,
		};
		window.__flipProbe = probe;
		let last = -1;
		const tick = (t: number) => {
			if (window.__flipProbe !== probe) return;
			if (last >= 0) probe.frames.push(t - last);
			last = t;
			probe.raf = requestAnimationFrame(tick);
		};
		probe.raf = requestAnimationFrame(tick);
		try {
			probe.observer = new PerformanceObserver((list) => {
				if (window.__flipProbe !== probe) return;
				for (const entry of list.getEntries())
					probe.longtaskMs += entry.duration;
			});
			probe.observer.observe({ type: "longtask", buffered: false });
		} catch {
			/* longtask unsupported — frame gaps still measured */
		}
	});
}

/** Stop the probe and reduce its samples into metrics. */
async function stopFrameProbe(page: Page): Promise<FrameMetrics> {
	const samples = await page.evaluate(() => {
		const probe = window.__flipProbe;
		window.__flipProbe = undefined;
		if (!probe) return { frames: [], longtaskMs: 0 };
		cancelAnimationFrame(probe.raf);
		// A long task can finish just before this evaluation, with its delivery
		// still queued. Disconnecting first would silently drop that sample.
		for (const entry of probe.observer?.takeRecords() ?? []) {
			probe.longtaskMs += entry.duration;
		}
		probe.observer?.disconnect();
		return {
			frames: probe.frames,
			longtaskMs: probe.longtaskMs,
		};
	});
	return reduceFrameSamples(samples, FRAME_GAP_BUDGET_MS);
}

/** The book writes the numeric chapter URL only after committing a spread. */
function committedChapterId(page: Page): number {
	const match = /^\/(?:929|dev\/sefer)\/(\d+)$/.exec(
		new URL(page.url()).pathname,
	);
	expect(
		match,
		"the mid-book workload has a numeric chapter URL",
	).not.toBeNull();
	return Number(match?.[1]);
}

/**
 * Click "next page" `n` times in quick succession and return the elapsed ms.
 * Uses the toolbar's "next" button which has a stable aria-label.
 */
async function rapidFlips(page: Page, n: number): Promise<number> {
	const nextBtn = page.locator("button.flipbook-toolbar-next");
	await expect(nextBtn).toBeVisible({ timeout: 5_000 });
	const initialChapter = committedChapterId(page);

	const start = Date.now();
	for (let i = 0; i < n; i++) {
		await nextBtn.click();
		// Small pause so the flip animation begins — without this the clicks
		// may coalesce into a single event.
		await page.waitForTimeout(120);
	}
	// Keep the 600ms sampling window, then require the final animation to finish.
	// A full turn takes about 800ms; the window alone can observe a partial turn.
	await page.waitForTimeout(600);
	await expect(page.locator(".he-book .page--flipping")).toHaveCount(0);
	expect(
		committedChapterId(page),
		"rapid next clicks must commit a later spread before measuring completes",
	).toBeGreaterThan(initialChapter);
	return Date.now() - start;
}

/** RTL turns start at the left outer edge for forward, right for backward. */
async function pageEdge(
	page: Page,
	forward: boolean,
): Promise<{ edge: number; y: number; destination: number } | null> {
	return page.evaluate((turnForward) => {
		const pages = [...document.querySelectorAll(".he-book .page.current-page")];
		let target: {
			x: number;
			w: number;
			h: number;
			y: number;
		} | null = null;
		for (const p of pages) {
			const r = p.getBoundingClientRect();
			if (r.width < 40 || r.height < 40) continue;
			if (
				!target ||
				(turnForward ? r.x < target.x : r.x + r.width > target.x + target.w)
			) {
				target = { x: r.x, w: r.width, h: r.height, y: r.y };
			}
		}
		if (!target) return null;
		const edge = turnForward ? target.x + 10 : target.x + target.w - 10;
		return {
			edge,
			y: target.y + target.h * 0.55,
			// Cross the spine (half of the full fold), so release commits
			// by distance even when CPU load makes the gesture slow.
			destination: edge + target.w * (turnForward ? 1.4 : -1.4),
		};
	}, forward);
}

/** Perform `n` pointer drag-turns (forward, then alternating back). */
async function dragTurns(page: Page, n: number): Promise<void> {
	for (let i = 0; i < n; i++) {
		const forward = i % 2 === 0;
		const initialChapter = committedChapterId(page);
		const target = await pageEdge(page, forward);
		if (!target) throw new Error("no visible page to drag");
		const steps = 14;
		await page.mouse.move(target.edge, target.y);
		await page.mouse.down();
		for (let s = 1; s <= steps; s++) {
			await page.mouse.move(
				target.edge + ((target.destination - target.edge) * s) / steps,
				target.y,
			);
			await page.waitForTimeout(11);
		}
		await page.mouse.up();
		await page.waitForTimeout(700);
		expect(
			committedChapterId(page),
			`${forward ? "forward" : "backward"} RTL drag must commit its spread`,
		).toBe(initialChapter + (forward ? 1 : -1));
	}
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

/**
 * Per-field minimum across runs — the least-contended batch.  Assertions
 * run on the minimum so a transient CPU spike on a shared CI runner
 * cannot poison the total; reports keep the summed metrics.
 */
function minMetrics(runs: FrameMetrics[]): FrameMetrics {
	return runs.reduce(
		(best, m) => ({
			frames: Math.min(best.frames, m.frames),
			blockedMs: Math.min(best.blockedMs, m.blockedMs),
			longFrames: Math.min(best.longFrames, m.longFrames),
			longtaskMs: Math.min(best.longtaskMs, m.longtaskMs),
		}),
		{
			frames: Number.POSITIVE_INFINITY,
			blockedMs: Number.POSITIVE_INFINITY,
			longFrames: Number.POSITIVE_INFINITY,
			longtaskMs: Number.POSITIVE_INFINITY,
		},
	);
}

interface RouteSamples {
	/** Wall-clock ms per batch — click workloads only. */
	times: number[];
	batches: FrameMetrics[];
}

/**
 * Run `workload` RUNS times against each route under the frame probe.
 * Routes alternate run-by-run so warmup and transient CPU contention
 * land on both sides of the comparison.
 */
async function measureRoutes(
	page: Page,
	workload: (page: Page) => Promise<unknown>,
): Promise<{ dev: RouteSamples; seo: RouteSamples }> {
	const results: { dev: RouteSamples; seo: RouteSamples } = {
		dev: { times: [], batches: [] },
		seo: { times: [], batches: [] },
	};
	for (let run = 0; run < RUNS; run++) {
		for (const [key, url] of [
			["dev", `http://localhost:3001/dev/sefer/${PEREK_ID}`],
			["seo", `http://localhost:3001/929/${PEREK_ID}?book`],
		] as const) {
			// `load` is sufficient and ~1s cheaper than `networkidle`:
			// `.flipbook-toolbar` is rendered by React itself, so its
			// presence already proves hydration reached the book, and the
			// post-mount settle covers listener attachment.
			await page.goto(url, { waitUntil: "load" });
			await waitForFlipBook(page);
			await startFrameProbe(page);
			const elapsed = await workload(page);
			if (typeof elapsed === "number") results[key].times.push(elapsed);
			results[key].batches.push(await stopFrameProbe(page));
		}
	}
	return results;
}

/** CPU-scaled main-thread budgets for one workload batch. */
function scaledBounds(cpuFactor: number) {
	return {
		blockedMs: MAX_BLOCKED_MS_PER_BATCH * cpuFactor,
		longtaskMs: MAX_LONGTASK_MS_PER_BATCH * cpuFactor,
	};
}

/** Assert one least-contended batch stayed inside the scaled budgets. */
function expectWithinBudget(
	label: string,
	metrics: FrameMetrics,
	bounds: { blockedMs: number; longtaskMs: number },
	cpuFactor: number,
): void {
	expect(
		metrics.blockedMs,
		`${label} batch blocked the main thread ${metrics.blockedMs.toFixed(0)}ms ` +
			`(${metrics.longFrames} frames >50ms) — over the ` +
			`${bounds.blockedMs.toFixed(0)}ms budget (cpu×${cpuFactor.toFixed(2)})`,
	).toBeLessThanOrEqual(bounds.blockedMs);
	expect(
		metrics.longtaskMs,
		`${label} batch spent ${metrics.longtaskMs.toFixed(0)}ms in longtasks ` +
			`— over the ${bounds.longtaskMs.toFixed(0)}ms budget ` +
			`(cpu×${cpuFactor.toFixed(2)})`,
	).toBeLessThanOrEqual(bounds.longtaskMs);
}

test.describe("Sefer flip performance", () => {
	// Sefer view requires tablet+ viewport
	test.beforeEach(async ({ page }) => {
		const vp = page.viewportSize();
		test.skip((vp?.width ?? 0) < 768, "Sefer view requires tablet+ viewport");
	});

	test("929 route flips must not be significantly slower than dev route", async ({
		page,
	}) => {
		const cpuFactor = await cpuSpeedFactor(page);
		const bounds = scaledBounds(cpuFactor);

		const { dev, seo } = await measureRoutes(page, (p) => rapidFlips(p, FLIPS));

		const devAvg = trimmedMean(dev.times);
		const seoAvg = trimmedMean(seo.times);
		// Assertions run on the least-contended batch (per-field minimum);
		// reported metrics keep the totals across runs.
		const devClick = minMetrics(dev.batches);
		const seoClick = minMetrics(seo.batches);

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
		// Keep Bencher's common-mode limit identical to the browser assertion.
		reportFrameBlockingBenchmark(
			"sefer-flip/dev-click-blocked",
			devClick.blockedMs,
			bounds.blockedMs,
		);
		reportFrameBlockingBenchmark(
			"sefer-flip/929-click-blocked",
			seoClick.blockedMs,
			bounds.blockedMs,
		);

		console.log(
			`\n📊 Flip perf — dev: ${devAvg.toFixed(0)}ms | 929: ${seoAvg.toFixed(0)}ms | ratio: ${ratio.toFixed(2)}x | cpu×${cpuFactor.toFixed(2)} (min-of-runs below)\n` +
				`   click blocked — dev: ${devClick.blockedMs.toFixed(0)}ms/${devClick.longFrames} long frames (${devClick.longtaskMs.toFixed(0)}ms longtasks) | 929: ${seoClick.blockedMs.toFixed(0)}ms/${seoClick.longFrames} long frames (${seoClick.longtaskMs.toFixed(0)}ms longtasks)\n`,
		);

		expect(
			ratio,
			`929 route is ${ratio.toFixed(2)}x slower than dev route (threshold: ${MAX_RATIO}x). ` +
				`dev=${devAvg.toFixed(0)}ms, 929=${seoAvg.toFixed(0)}ms`,
		).toBeLessThanOrEqual(MAX_RATIO);

		// Common-mode budget: catastrophic blocking fails on BOTH routes.
		expectWithinBudget("dev click", devClick, bounds, cpuFactor);
		expectWithinBudget("929 click", seoClick, bounds, cpuFactor);
	});

	test("drag turns must not block the main thread", async ({ page }) => {
		const cpuFactor = await cpuSpeedFactor(page);
		const bounds = scaledBounds(cpuFactor);

		const { dev, seo } = await measureRoutes(page, (p) => dragTurns(p, DRAGS));

		const devDrag = minMetrics(dev.batches);
		const seoDrag = minMetrics(seo.batches);

		reportFrameBlockingBenchmark(
			"sefer-flip/dev-drag-blocked",
			devDrag.blockedMs,
			bounds.blockedMs,
		);
		reportFrameBlockingBenchmark(
			"sefer-flip/929-drag-blocked",
			seoDrag.blockedMs,
			bounds.blockedMs,
		);

		console.log(
			`\n📊 Drag perf | cpu×${cpuFactor.toFixed(2)} (min-of-runs below)\n` +
				`   drag blocked — dev: ${devDrag.blockedMs.toFixed(0)}ms/${devDrag.longFrames} long frames (${devDrag.longtaskMs.toFixed(0)}ms longtasks) | 929: ${seoDrag.blockedMs.toFixed(0)}ms/${seoDrag.longFrames} long frames (${seoDrag.longtaskMs.toFixed(0)}ms longtasks)\n`,
		);

		expectWithinBudget("dev drag", devDrag, bounds, cpuFactor);
		expectWithinBudget("929 drag", seoDrag, bounds, cpuFactor);
	});
});
