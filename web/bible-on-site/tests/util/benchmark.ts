import { resolve } from "node:path";
import { writeBenchmark } from "../../scripts/benchmark-store.cjs";

/**
 * Unified measure names for Bencher reporting.
 * Grouping by scale prevents sparse matrices in Bencher reports.
 *
 * Each measure represents a distinct scale/unit:
 * - `time_ms`: Timing metrics in milliseconds (FCP, LCP, TBT, TTFB, INP, etc.)
 * - `memory_mb`: Memory usage in megabytes (browser heap, server RSS, server heap)
 * - `size_mb`: File/directory sizes in megabytes (standalone bundle, .next dir)
 * - `score`: Pass/fail or 0-1 scores (audit scores, category scores)
 * - `ratio`: Ratios/proportions (sefer flip 929-vs-dev ratio)
 * - `frame_budget_ratio`: Blocking/response time divided by its existing browser
 *   test budget. A static bound of 1 preserves that budget even when healthy
 *   blocking time is zero or close to zero, including Lighthouse TBT.
 * - `cls_ratio`: Cumulative Layout Shift. CLS gets its own measure so the
 *   Bencher threshold can use a static bound: a percentage threshold on a
 *   zero CLS baseline collapses the upper boundary limit to 0 and alerts on
 *   any nonzero reading (#2718).
 * - `bytes`: Raw byte counts
 * - `count`: Element/item counts
 */
export type BencherMeasure =
	| "time_ms"
	| "memory_mb"
	| "size_mb"
	| "score"
	| "ratio"
	| "frame_budget_ratio"
	| "cls_ratio"
	| "bytes"
	| "count";

export interface BenchmarkEntry {
	/** Benchmark name (e.g., "/ - LCP", "/929/567 - FCP", "build", "memory") */
	name: string;
	/** Unified measure name - must be one of the BencherMeasure types */
	measure: BencherMeasure;
	/** The measured value */
	value: number;
	/** Optional lower bound (for scores where regression = decrease) */
	lowerValue?: number;
	/** Optional upper bound (for timing/size where regression = increase) */
	upperValue?: number;
}

const BENCHMARK_OUTPUT_DIR = resolve(
	__dirname,
	"../../.playwright-report/perf/bencher",
);

/**
 * Appends a benchmark entry to the benchmark output file.
 * Format compatible with Bencher Metric Format (BMF) JSON.
 * @see https://bencher.dev/docs/reference/bencher-metric-format/
 */
export function reportBenchmark(entry: BenchmarkEntry): void {
	writeBenchmark(BENCHMARK_OUTPUT_DIR, entry);
}

/** Report frame blocking against the same calibrated bound as the browser test. */
export function reportFrameBlockingBenchmark(
	name: string,
	blockedMs: number,
	budgetMs: number,
): void {
	reportBenchmark({
		name,
		measure: "frame_budget_ratio",
		value: blockedMs / budgetMs,
		upperValue: 1,
	});
}

/**
 * Converts a timing benchmark that carries its own test budget (`upperValue`)
 * into the static-bound `frame_budget_ratio` measure. Sub-50ms interaction
 * timings — Web Vitals INP/TTFB measure 5-48ms and arrive quantized to 8ms —
 * sit under the runner-jitter floor of a percentage-of-history threshold, the
 * same false-alert class as `sefer-flip/*-drag-blocked` (#2971). Their Bencher
 * bound becomes the browser test's existing "good" budget instead of a noisy
 * fraction of near-zero history; entries without a positive finite budget are
 * returned untouched.
 */
export function budgetedTimingBenchmarkEntry(
	entry: BenchmarkEntry,
): BenchmarkEntry {
	if (
		entry.measure !== "time_ms" ||
		typeof entry.upperValue !== "number" ||
		!Number.isFinite(entry.upperValue) ||
		entry.upperValue <= 0
	)
		return entry;
	return {
		...entry,
		measure: "frame_budget_ratio",
		value: entry.value / entry.upperValue,
		upperValue: 1,
	};
}

/**
 * Maps a Web Vitals metric name to its unified Bencher measure name.
 * CLS is the only unitless Web Vitals metric; all others are timings.
 */
export function webVitalsMeasure(metricName: string): BencherMeasure {
	return metricName === "CLS" ? "cls_ratio" : "time_ms";
}

/**
 * Maps Lighthouse numericUnit to a unified Bencher measure name.
 */
export function getLighthouseMeasure(
	numericUnit: string | undefined,
): BencherMeasure {
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
