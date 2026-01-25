import { execSync, fork, spawnSync } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

// Setup logging
const logDir = path.resolve(__dirname, ".log");
mkdirSync(logDir, { recursive: true });
const logFile = path.resolve(logDir, "api_launcher.log");

function log(message: string): void {
	const timestamp = new Date().toISOString();
	const line = `[${timestamp}] ${message}\n`;
	console.log(message);
	try {
		writeFileSync(logFile, line, { flag: "a" });
	} catch (e) {
		console.error(`[Launcher] Failed to append log:`, e);
	}
}

try {
	await main();
} catch (err) {
	console.error(err);
	process.exit(1);
}

/**
 * Populate the test database before starting the API.
 * Runs `cargo make mysql-populate` from the data/ directory.
 */
async function populateDatabase(): Promise<void> {
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
		throw new Error(
			"Database population failed. The API server cannot start without a populated database.",
		);
	}
}

async function main() {
	process.chdir(path.resolve(__dirname, ".."));

	// Clear log file for fresh run
	writeFileSync(logFile, `[${new Date().toISOString()}] [INIT] API Launcher started\n`);

	// Populate database before starting the API
	await populateDatabase();

	const out = openSync(path.resolve(logDir, "api.log"), "w");

	// Fork with tsx loader via Node's --import flag
	// TODO: find a way without this ugly wrapper.
	// The original issue was that when the tests are finished, a signal is sent to this process which then kills the API as well.
	// The workaround is to have this wrapper process detached from the launcher process.
	const wrapper = fork(
		path.resolve(__dirname, "cargo_wrapper.mts"),
		process.argv.slice(2),
		{
			cwd: __dirname,
			detached: true,
			execArgv: ["--no-deprecation", "--trace-deprecation", "--import", "tsx"],
			silent: true,
			stdio: ["ignore", out, out, "ipc"],
		},
	);

	wrapper.unref();

	// Keep the process alive by monitoring in an infinite loop
	while (true) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}
