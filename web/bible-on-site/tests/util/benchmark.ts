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
