/**
 * E2E Test Server Launcher
 *
 * This script populates the test database (if DB_URL is set) and then starts
 * the Next.js server for E2E tests. This approach is more reliable than using
 * Playwright's globalSetup for database operations.
 *
 * Usage: node --import tsx ./launch-e2e-server.mts [--coverage]
 */

import { execSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup logging
const logDir = path.resolve(__dirname, ".playwright-report/setup");
mkdirSync(logDir, { recursive: true });
const logFile = path.resolve(logDir, "launcher.log");

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

// Clear log file for fresh run
writeFileSync(logFile, `[${new Date().toISOString()}] [INIT] E2E Server Launcher started\n`);

const useCoverage = process.argv.includes("--coverage");

try {
	await main();
} catch (err) {
	log(`[ERROR] ${err}`);
	process.exit(1);
}

/**
 * Populate the test database before starting the server.
 * Runs `cargo make mysql-populate` from the data/ directory.
 * Only runs if DB_URL environment variable is set.
 */
async function populateDatabase(): Promise<void> {
	const dbUrl = process.env.DB_URL;

	if (!dbUrl) {
		log("[DB Setup] DB_URL not set, skipping database population");
		return;
	}

	log("[DB Setup] ========================================");
	log("[DB Setup] Ensuring test database is populated...");
	log(`[DB Setup] Using database URL: ${dbUrl.replace(/:[^:@]+@/, ":***@")}`);

	// Path to data directory (relative to web/bible-on-site)
	const dataDirectory = path.resolve(__dirname, "../../data");
	log(`[DB Setup] Data directory: ${dataDirectory}`);

	// Check if cargo-make is available
	const cargoMakeCheck = spawnSync("cargo", ["make", "--version"], {
		shell: true,
		stdio: "pipe",
	});

	if (cargoMakeCheck.status !== 0) {
		log(`[DB Setup] cargo-make check failed with status: ${cargoMakeCheck.status}`);
		log(`[DB Setup] stderr: ${cargoMakeCheck.stderr?.toString()}`);
		throw new Error(
			"cargo-make is not installed. Install with: cargo install cargo-make",
		);
	}

	log("[DB Setup] cargo-make is available");
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
			"Database population failed. Articles E2E tests require a populated database.",
		);
	}
}

async function main() {
	// Populate database before starting the server
	await populateDatabase();

	// Start the Next.js server
	const command = useCoverage ? "npm" : "npm";
	const args = useCoverage ? ["run", "dev"] : ["run", "start"];

	log(`[Server] Starting Next.js server: ${command} ${args.join(" ")}`);

	const server = spawn(command, args, {
		cwd: __dirname,
		stdio: "inherit",
		shell: true,
		env: process.env,
	});

	server.on("error", (err) => {
		log(`[Server] Error: ${err.message}`);
		process.exit(1);
	});

	server.on("close", (code) => {
		log(`[Server] Process exited with code ${code}`);
		process.exit(code ?? 0);
	});

	// Handle termination signals
	process.on("SIGINT", () => {
		log("[Server] Received SIGINT, shutting down...");
		server.kill("SIGINT");
	});

	process.on("SIGTERM", () => {
		log("[Server] Received SIGTERM, shutting down...");
		server.kill("SIGTERM");
	});
}
