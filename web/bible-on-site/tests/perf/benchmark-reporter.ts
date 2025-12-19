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

export interface BenchmarkEntry {
	/** Benchmark name (e.g., "/ - LCP", "/929/567 - FCP") */
	name: string;
	/** Measure name (e.g., "latency", "cls", "lcp") */
	measure: string;
	/** The measured value */
	value: number;
	/** Optional lower bound */
	lowerValue?: number;
	/** Optional upper bound (threshold) */
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
