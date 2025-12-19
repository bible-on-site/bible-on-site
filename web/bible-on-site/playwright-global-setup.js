// TODO: try to convert to ESM when Playwright supports it
const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const BENCHMARK_OUTPUT_DIR = resolve(
	__dirname,
	".playwright-report/perf/bencher",
);
const BENCHMARK_OUTPUT_FILE = resolve(BENCHMARK_OUTPUT_DIR, "benchmark.json");

/** @param {import('@playwright/test').FullConfig} config */
// biome-ignore lint/correctness/noUnusedFunctionParameters: framework required function signature
module.exports = async function globalSetup(config) {
	rmSync(resolve(__dirname, ".cache", "playwright"), {
		recursive: true,
		force: true,
	});

	// Clear benchmark file for fresh perf test run (Bencher Metric Format uses object)
	mkdirSync(BENCHMARK_OUTPUT_DIR, { recursive: true });
	writeFileSync(BENCHMARK_OUTPUT_FILE, "{}", "utf8");
};
