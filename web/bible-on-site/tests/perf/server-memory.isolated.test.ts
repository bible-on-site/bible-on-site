import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { reportBenchmark } from "../util/benchmark";

/**
 * Routes to exercise during memory benchmarking.
 * These should represent typical usage patterns.
 */
const BENCHMARK_ROUTES = [
	"/",
	"/929",
	"/929/1",
	"/929/567",
	"/929/686",
	"/929/188",
	"/929/250",
	"/929/727",
	"/929/764",
];

const BYTES_PER_MB = 1024 * 1024;
const MEMORY_API_URL = "http://127.0.0.1:3001/api/dev/memory";

/**
 * Server memory response from the /api/dev/memory endpoint.
 */
interface ServerMemoryResponse {
	rss: number;
	heapTotal: number;
	heapUsed: number;
	external: number;
	arrayBuffers: number;
}

/**
 * Get Next.js server process memory usage via the /api/dev/memory endpoint.
 */
async function getServerMemoryBytes(): Promise<ServerMemoryResponse | null> {
	try {
		const response = await fetch(MEMORY_API_URL);
		if (!response.ok) {
			console.warn(`Memory API returned ${response.status}`);
			return null;
		}
		return (await response.json()) as ServerMemoryResponse;
	} catch (error) {
		console.warn("Failed to get server memory:", error);
		return null;
	}
}

/**
 * Exercise the page with typical user interactions to trigger memory allocations.
 */
async function exercisePage(page: Page): Promise<void> {
	// Scroll to trigger lazy loading
	await page.evaluate(() => {
		window.scrollTo(0, document.body.scrollHeight / 2);
	});
	await page.waitForTimeout(100);

	// Scroll back to top
	await page.evaluate(() => {
		window.scrollTo(0, 0);
	});
	await page.waitForTimeout(100);

	// Click some interactive elements if they exist
	const buttons = page.locator("button");
	const buttonCount = await buttons.count();
	if (buttonCount > 0) {
		try {
			await buttons.first().click({ timeout: 500 });
		} catch {
			// Button might not be clickable, that's fine
		}
	}
}

test.describe("Server Memory", () => {
	test.describe.configure({ mode: "serial" });

	test("Remains below 1024MB (RSS), 512MB (Heap) during general interaction", async ({
		page,
	}) => {
		let peakServerRssBytes = 0;
		let peakServerHeapBytes = 0;

		// Visit each route and measure server memory
		for (const route of BENCHMARK_ROUTES) {
			await page.goto(route);
			await page.waitForLoadState("networkidle");

			// Exercise the page to trigger server-side activity
			await exercisePage(page);

			// Measure Next.js server memory
			const serverMemory = await getServerMemoryBytes();
			const serverRss = serverMemory?.rss ?? 0;
			const serverHeap = serverMemory?.heapUsed ?? 0;

			console.log(
				`Route ${route}: server_rss=${(serverRss / BYTES_PER_MB).toFixed(1)}MB, server_heap=${(serverHeap / BYTES_PER_MB).toFixed(1)}MB`,
			);

			peakServerRssBytes = Math.max(peakServerRssBytes, serverRss);
			peakServerHeapBytes = Math.max(peakServerHeapBytes, serverHeap);
		}

		const peakServerRssMB = peakServerRssBytes / BYTES_PER_MB;
		const peakServerHeapMB = peakServerHeapBytes / BYTES_PER_MB;

		console.log(`Overall peak server RSS: ${peakServerRssMB.toFixed(2)} MB`);
		console.log(`Overall peak server heap: ${peakServerHeapMB.toFixed(2)} MB`);

		// Report server RSS memory - high threshold (1GB) for tracking
		const MAX_SERVER_RSS_MB = 1024;

		expect(
			peakServerRssBytes,
			"Server memory API should respond. Ensure /api/dev/memory endpoint is available.",
		).toBeGreaterThan(0);

		reportBenchmark({
			name: "memory: server RSS",
			measure: "memory_mb",
			value: peakServerRssMB,
			upperValue: MAX_SERVER_RSS_MB,
		});

		expect(peakServerRssMB).toBeLessThan(MAX_SERVER_RSS_MB);

		// Report server heap memory - high threshold (512MB) for tracking
		const MAX_SERVER_HEAP_MB = 512;

		reportBenchmark({
			name: "memory: server heap",
			measure: "memory_mb",
			value: peakServerHeapMB,
			upperValue: MAX_SERVER_HEAP_MB,
		});

		expect(peakServerHeapMB).toBeLessThan(MAX_SERVER_HEAP_MB);
	});
});
