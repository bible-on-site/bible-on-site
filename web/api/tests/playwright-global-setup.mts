/**
 * Playwright Global Setup - Database Population for Local Development
 *
 * This setup ensures the test database is populated before running E2E tests.
 * - In CI: Skips population (already done by CI workflow before tests)
 * - Locally: Runs `cargo make mysql-populate` from the data/ directory
 *
 * Reuses the same logic as CI to maintain consistency.
 */

import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function globalSetup(): Promise<void> {
	console.log("[DB Setup] Ensuring test database is populated...");

	// Path to data directory (relative to web/api/tests)
	const dataDirectory = path.resolve(__dirname, "../../../data");

	// Check if cargo-make is available
	const cargoMakeCheck = spawnSync("cargo", ["make", "--version"], {
		shell: true,
		stdio: "pipe",
	});

	if (cargoMakeCheck.status !== 0) {
		console.warn(
			"[DB Setup] WARNING: cargo-make is not installed. Install with: cargo install cargo-make",
		);
		console.warn(
			"[DB Setup] Skipping database population - tests may fail if database is empty.",
		);
		return;
	}

	// Check if DB_URL is set, if not use default test database URL
	const dbUrl =
		process.env.DB_URL || "mysql://root:test_123@localhost:3306/tanah_test";

	console.log(
		`[DB Setup] Using database URL: ${dbUrl.replace(/:[^:@]+@/, ":***@")}`,
	);
	console.log(
		`[DB Setup] Running: cargo make mysql-populate in ${dataDirectory}`,
	);

	try {
		execSync("cargo make mysql-populate", {
			cwd: dataDirectory,
			stdio: "inherit",
			env: {
				...process.env,
				DB_URL: dbUrl,
			},
		});
		console.log("[DB Setup] Database population completed successfully.");
	} catch (error) {
		console.error("[DB Setup] ERROR: Failed to populate database:", error);
		console.warn(
			"[DB Setup] Tests will continue but may fail if database is not properly populated.",
		);
		console.warn("[DB Setup] Make sure MySQL is running and accessible.");
	}
}

export default globalSetup;
