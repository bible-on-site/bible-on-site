/**
 * Playwright Global Setup - Database Population
 *
 * This setup ensures the test database is populated before running E2E tests.
 * Runs `cargo make mysql-populate` from the data/ directory to populate
 * the tanah_test database with test data.
 *
 * IMPORTANT: This must succeed for the API server to start correctly.
 * If database population fails, the setup will throw an error to fail fast.
 *
 * Using CommonJS format for Playwright compatibility.
 */

const { execSync, spawnSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

// Create a log file for debugging CI issues
const logDir = path.resolve(__dirname, ".log");
try {
	mkdirSync(logDir, { recursive: true });
} catch (e) {
	console.error(`[GlobalSetup] Failed to create log directory ${logDir}:`, e);
}
const logFile = path.resolve(logDir, "global-setup.log");

// Write an initial marker immediately to confirm module was loaded
try {
	writeFileSync(
		logFile,
		`[${new Date().toISOString()}] [INIT] Module loaded. __dirname=${__dirname}\n`,
	);
} catch (e) {
	console.error(`[GlobalSetup] Failed to write initial log to ${logFile}:`, e);
}

function log(message) {
	const timestamp = new Date().toISOString();
	const line = `[${timestamp}] ${message}\n`;
	console.log(message);
	try {
		writeFileSync(logFile, line, { flag: "a" });
	} catch (e) {
		console.error(`[GlobalSetup] Failed to append log:`, e);
	}
}

async function globalSetup() {
	log("[DB Setup] ========================================");
	log("[DB Setup] Ensuring test database is populated...");
	log(`[DB Setup] Current directory: ${process.cwd()}`);

	// Path to data directory (relative to web/api/tests)
	const dataDirectory = path.resolve(__dirname, "../../../data");
	log(`[DB Setup] Data directory: ${dataDirectory}`);

	log("[DB Setup] Checking if cargo-make is available...");

	// Check if cargo-make is available
	const cargoMakeCheck = spawnSync("cargo", ["make", "--version"], {
		shell: true,
		stdio: "pipe",
	});

	if (cargoMakeCheck.status !== 0) {
		log(
			`[DB Setup] cargo-make check failed with status: ${cargoMakeCheck.status}`,
		);
		log(`[DB Setup] stderr: ${cargoMakeCheck.stderr?.toString()}`);
		throw new Error(
			"cargo-make is not installed. Install with: cargo install cargo-make",
		);
	}

	log("[DB Setup] cargo-make is available");

	// Check if DB_URL is set, if not use default test database URL
	const dbUrl =
		process.env.DB_URL || "mysql://root:test_123@localhost:3306/tanah_test";

	log(`[DB Setup] Using database URL: ${dbUrl.replace(/:[^:@]+@/, ":***@")}`);
	log(`[DB Setup] Running: cargo make mysql-populate in ${dataDirectory}`);

	try {
		log("[DB Setup] Starting database population...");
		execSync("cargo make mysql-populate", {
			cwd: dataDirectory,
			stdio: "inherit",
			env: {
				...process.env,
				DB_URL: dbUrl,
			},
		});
		log("[DB Setup] Database population completed successfully.");
		log("[DB Setup] ========================================");
	} catch (error) {
		log(`[DB Setup] ERROR: Failed to populate database: ${error}`);
		log("[DB Setup] ========================================");
		// Fail fast - don't continue with tests if DB population failed
		throw new Error(
			"Database population failed. The API server cannot start without a populated database.",
		);
	}
}

module.exports = globalSetup;
