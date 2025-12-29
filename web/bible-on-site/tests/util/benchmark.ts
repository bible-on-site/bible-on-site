import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Bencher Metric Format (BMF) types.
 * @see https://bencher.dev/docs/reference/bencher-metric-format/
 */
interface BencherMetric {
	value: number;
	lower_value?: number;
	upper_value?: number;
}

interface BencherMeasures {
	[measureName: string]: BencherMetric;
}

interface BencherMetricFormat {
	[benchmarkName: string]: BencherMeasures;
}

/**
 * Unified measure names for Bencher reporting.
 * Grouping by scale prevents sparse matrices in Bencher reports.
 *
 * Each measure represents a distinct scale/unit:
 * - `time_ms`: Timing metrics in milliseconds (FCP, LCP, TBT, TTFB, INP, etc.)
 * - `memory_mb`: Memory usage in megabytes (browser heap, server RSS, server heap)
 * - `size_mb`: File/directory sizes in megabytes (standalone bundle, .next dir)
 * - `score`: Pass/fail or 0-1 scores (audit scores, category scores)
 * - `ratio`: Ratios/proportions (CLS)
 * - `bytes`: Raw byte counts
 * - `count`: Element/item counts
 */
export type BencherMeasure =
	| "time_ms"
	| "memory_mb"
	| "size_mb"
	| "score"
	| "ratio"
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
const BENCHMARK_OUTPUT_FILE = resolve(BENCHMARK_OUTPUT_DIR, "benchmark.json");

/**
 * Appends a benchmark entry to the benchmark output file.
 * Format compatible with Bencher Metric Format (BMF) JSON.
 * @see https://bencher.dev/docs/reference/bencher-metric-format/
 */
export function reportBenchmark(entry: BenchmarkEntry): void {
	mkdirSync(BENCHMARK_OUTPUT_DIR, { recursive: true });

	let bmf: BencherMetricFormat = {};
	if (existsSync(BENCHMARK_OUTPUT_FILE)) {
		try {
			bmf = JSON.parse(readFileSync(BENCHMARK_OUTPUT_FILE, "utf8"));
		} catch {
			console.warn("Failed to parse existing benchmark file, starting fresh");
			bmf = {};
		}
	}

	// Initialize benchmark entry if it doesn't exist
	if (!bmf[entry.name]) {
		bmf[entry.name] = {};
	}

	// Add the measure
	const metric: BencherMetric = { value: entry.value };
	if (entry.lowerValue !== undefined) {
		metric.lower_value = entry.lowerValue;
	}
	if (entry.upperValue !== undefined) {
		metric.upper_value = entry.upperValue;
	}
	bmf[entry.name][entry.measure] = metric;

	writeFileSync(BENCHMARK_OUTPUT_FILE, JSON.stringify(bmf, null, 2), "utf8");
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
