// TODO: try to convert to ESM when Playwright supports it
const { mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const BENCHMARK_OUTPUT_DIR = resolve(
	__dirname,
	".playwright-report/perf/bencher",
);
const BENCHMARK_OUTPUT_FILE = resolve(BENCHMARK_OUTPUT_DIR, "benchmark.json");

const WEB_SERVER_URL = "http://127.0.0.1:3001";

// Routes to warm up before running e2e tests with coverage
const WARMUP_ROUTES = [
	"",
	"929",
	"929/1",
	"929/188",
	"929/250",
	"929/727",
	"929/764",
];

/**
 * Warm up the server by making requests to key routes.
 * This helps stabilize tests when running with coverage instrumentation,
 * which adds overhead that can cause timeouts on cold starts.
 */
async function warmUpServer() {
	// Dynamically import ESM module to get shouldMeasureCov flag  // TODO: import regularly when this file is ESM
	const { shouldMeasureCov } = await import(
		"../shared/tests-util/environment.mjs"
	);
	if (!shouldMeasureCov) {
		return;
	}

	console.log("[global-setup] Warming up server for coverage run...");

	// Wait for server to be ready
	const maxRetries = 30;
	const retryDelay = 1000;

	for (let i = 0; i < maxRetries; i++) {
		try {
			const response = await fetch(`${WEB_SERVER_URL}/`);
			if (response.ok) {
				break;
			}
		} catch {
			// Server not ready yet
		}
		if (i === maxRetries - 1) {
			console.warn(
				"[global-setup] Server did not become ready for warmup, skipping",
			);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, retryDelay));
	}

	// Warm up each route sequentially to avoid overwhelming the dev server
	for (const route of WARMUP_ROUTES) {
		try {
			const response = await fetch(`${WEB_SERVER_URL}/${route}`);
			if (response.ok) {
				// Consume the response body to ensure full page generation
				await response.text();
				console.log(`[global-setup] Warmed up ${route || "/"}`);
			} else {
				console.warn(
					`[global-setup] Warmup request to ${route || "/"} returned ${response.status}`,
				);
			}
		} catch (err) {
			console.warn(
				`[global-setup] Failed to warm up ${route || "/"}:`,
				err.message,
			);
		}
	}

	console.log("[global-setup] Server warmup complete");
}

/** @param {import('@playwright/test').FullConfig} config */
// biome-ignore lint/correctness/noUnusedFunctionParameters: framework required function signature
module.exports = async function globalSetup(config) {
	// Clear benchmark file for fresh perf test run (Bencher Metric Format uses object)
	mkdirSync(BENCHMARK_OUTPUT_DIR, { recursive: true });
	writeFileSync(BENCHMARK_OUTPUT_FILE, "{}", "utf8");

	// Warm up server when running with coverage
	await warmUpServer();
};
