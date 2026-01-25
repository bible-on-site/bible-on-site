import { execSync } from "node:child_process";
import { mkdir, stat, watch } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shouldMeasureCov } from "../../shared/tests-util/environment.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COVERAGE_FILE_PATH = path.resolve(__dirname, "../.coverage/e2e/lcov.info");
const COVERAGE_DIR_PATH = path.dirname(COVERAGE_FILE_PATH);
const COVERAGE_FILE_NAME = path.basename(COVERAGE_FILE_PATH);
const COVERAGE_WAIT_TIMEOUT_MS = 30_000;

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
		console.log(`[Teardown] Warning: Failed to drop test database: ${error.message}`);
	}
};

const isCoverageReady = async () => {
	try {
		const fileStats = await stat(COVERAGE_FILE_PATH);
		return fileStats.size > 0;
	} catch (error) {
		if (error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
};

const waitForCoverageFile = async () => {
	await mkdir(COVERAGE_DIR_PATH, { recursive: true });
	if (await isCoverageReady()) {
		return;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(
		() => controller.abort(),
		COVERAGE_WAIT_TIMEOUT_MS,
	);
	let coverageReady = false;

	try {
		for await (const event of watch(COVERAGE_DIR_PATH, {
			signal: controller.signal,
		})) {
			if (event.filename && event.filename !== COVERAGE_FILE_NAME) {
				continue;
			}

			if (await isCoverageReady()) {
				coverageReady = true;
				controller.abort();
			}
		}
	} catch (error) {
		if (coverageReady && error.name === "AbortError") {
			return;
		}

		if (error.name === "AbortError") {
			throw new Error(
				`Timed out waiting for coverage report at ${COVERAGE_FILE_PATH}`,
			);
		}

		throw error;
	} finally {
		clearTimeout(timeoutId);
	}

	if (!coverageReady) {
		throw new Error(
			`Timed out waiting for coverage report at ${COVERAGE_FILE_PATH}`,
		);
	}
};

const globalTeardown = async () => {
	await fetch("http://127.0.0.1:3003/api/shutdown", {
		method: "POST",
	});

	if (shouldMeasureCov) {
		await waitForCoverageFile();
	}

	// Drop the test database to ensure clean state for next run
	// This helps reproduce CI issues locally
	await dropTestDatabase();
};

export default globalTeardown;
