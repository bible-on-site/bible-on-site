import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { waitForCoverageFile } from "./coverage-file.mjs";

// Playwright loads global teardown in a separate module context from the config.
// Read this flag locally to avoid its .mjs transform changing the shared module's exports.
const shouldMeasureCov = process.env.MEASURE_COV === "1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COVERAGE_FILE_PATH = path.resolve(
	__dirname,
	"../.coverage/e2e/lcov.info",
);

/**
 * Drop the test database to ensure a clean state for the next run.
 * This helps reproduce CI issues locally where the database doesn't persist.
 */
const dropTestDatabase = async () => {
	const dbUrl =
		process.env.DB_URL || "mysql://root:test_123@localhost:3306/tanah_test";
	const dataDirectory = path.resolve(__dirname, "../../../data");

	console.log("[Teardown] Dropping test database for clean state...");
	try {
		execSync("cargo make mysql-drop", {
			cwd: dataDirectory,
			stdio: "inherit",
			env: {
				...process.env,
				DB_URL: dbUrl,
			},
		});
		console.log("[Teardown] Test database dropped successfully.");
	} catch (error) {
		// Non-fatal - database might not exist or drop might fail for other reasons
		console.log(
			`[Teardown] Warning: Failed to drop test database: ${error.message}`,
		);
	}
};

const globalTeardown = async () => {
	const coverageNotBeforeMs = Date.now();
	await fetch("http://127.0.0.1:3003/api/shutdown", {
		method: "POST",
	});

	if (shouldMeasureCov) {
		await waitForCoverageFile(COVERAGE_FILE_PATH, {
			notBeforeMs: coverageNotBeforeMs,
		});
	}

	// Drop the test database to ensure clean state for next run
	// This helps reproduce CI issues locally
	await dropTestDatabase();
};

export default globalTeardown;
