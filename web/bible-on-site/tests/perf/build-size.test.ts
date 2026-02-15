import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { reportBenchmark } from "../util/benchmark";

const NEXT_BUILD_DIR = resolve(__dirname, "../../.next");
const STANDALONE_DIR = resolve(NEXT_BUILD_DIR, "standalone");

/**
 * Get directory size in bytes using Node.js fs APIs.
 * Recursively calculates the total size of all files in the directory.
 */
function getDirectorySizeBytes(dirPath: string): number {
	if (!existsSync(dirPath)) {
		throw new Error(`Directory does not exist: ${dirPath}`);
	}

	let totalSize = 0;

	function calculateSize(currentPath: string): void {
		const stats = statSync(currentPath);

		if (stats.isFile()) {
			totalSize += stats.size;
		} else if (stats.isDirectory()) {
			const entries = readdirSync(currentPath);
			for (const entry of entries) {
				calculateSize(join(currentPath, entry));
			}
		}
	}

	calculateSize(dirPath);
	return totalSize;
}

const BYTES_PER_MB = 1024 * 1024;

test.describe("Build Size Benchmarks", () => {
	// Only run once (skip on non-Desktop projects since we don't need a browser)
	// biome-ignore lint/correctness/noEmptyPattern: Playwright requires object destructuring for fixtures
	test.beforeEach(({}, testInfo) => {
		if (testInfo.project.name !== "Desktop") {
			testInfo.skip(true, "Build size tests only run once, not per browser");
		}
	});

	test.describe("Standalone bundle size", () => {
		test("Remains below 1000MB", () => {
			expect(
				existsSync(STANDALONE_DIR),
				`Standalone directory should exist at ${STANDALONE_DIR}. Run 'npm run build' first.`,
			).toBe(true);

			const sizeBytes = getDirectorySizeBytes(STANDALONE_DIR);
			const sizeMB = sizeBytes / BYTES_PER_MB;

			console.log(
				`Standalone bundle size: ${sizeMB.toFixed(2)} MB (${sizeBytes} bytes)`,
			);

			// Report to Bencher - using MB as the unit for readability
			// Increased from 750 to 1000 to accommodate SSG perushim pages (~250 MB)
			const MAX_SIZE_MB = 1000;
			reportBenchmark({
				name: "build: standalone",
				measure: "size_mb",
				value: sizeMB,
				upperValue: MAX_SIZE_MB,
			});

			expect(sizeMB).toBeLessThan(MAX_SIZE_MB);
		});
	});

	test.describe(".next directory size", () => {
		test("Remains below 4096MB", () => {
			expect(
				existsSync(NEXT_BUILD_DIR),
				`Build directory should exist at ${NEXT_BUILD_DIR}. Run 'npm run build' first.`,
			).toBe(true);

			const sizeBytes = getDirectorySizeBytes(NEXT_BUILD_DIR);
			const sizeMB = sizeBytes / BYTES_PER_MB;

			console.log(
				`Total .next directory size: ${sizeMB.toFixed(2)} MB (${sizeBytes} bytes)`,
			);

			// Report to Bencher - upper threshold set high for tracking
			const MAX_SIZE_MB = 4096;
			reportBenchmark({
				name: "build: .next",
				measure: "size_mb",
				value: sizeMB,
				upperValue: MAX_SIZE_MB,
			});

			expect(sizeMB).toBeLessThan(MAX_SIZE_MB);
		});
	});
});
