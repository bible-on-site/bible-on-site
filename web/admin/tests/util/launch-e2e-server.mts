/**
 * E2E Test Server Launcher for Admin App
 *
 * This script:
 * 1. Loads test environment variables from .env.test
 * 2. Populates the test database (if DB_URL is set)
 * 3. Populates S3 with test images (if S3_ENDPOINT is set)
 * 4. Starts the Vite dev server for E2E tests
 *
 * Usage: node --import tsx ./tests/util/launch-e2e-server.mts
 */

import { execSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

// Load .env.test file
function loadEnvFile(filePath: string): void {
	if (!existsSync(filePath)) {
		return;
	}
	const content = readFileSync(filePath, "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const [key, ...valueParts] = trimmed.split("=");
		if (key && valueParts.length > 0) {
			const value = valueParts.join("=");
			// Don't override existing env vars
			if (!process.env[key]) {
				process.env[key] = value;
			}
		}
	}
}

// Load test environment
loadEnvFile(path.resolve(projectRoot, ".env.test"));

// Setup logging
const logDir = path.resolve(projectRoot, ".playwright-report/setup");
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
writeFileSync(
	logFile,
	`[${new Date().toISOString()}] [INIT] Admin E2E Server Launcher started\n`,
);

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

	// Path to data directory (relative to web/admin)
	const dataDirectory = path.resolve(projectRoot, "../../data");
	log(`[DB Setup] Data directory: ${dataDirectory}`);

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
			"Database population failed. Admin E2E tests require a populated database.",
		);
	}
}

/**
 * Populate S3 with test images.
 * Runs `cargo make s3-populate-test` from the data/ directory.
 * Only runs if S3_ENDPOINT environment variable is set (MinIO mode).
 */
async function populateS3(): Promise<void> {
	const s3Endpoint = process.env.S3_ENDPOINT;

	if (!s3Endpoint) {
		log("[S3 Setup] S3_ENDPOINT not set, skipping S3 population");
		return;
	}

	log("[S3 Setup] ========================================");
	log("[S3 Setup] Ensuring S3 bucket is populated...");
	log(`[S3 Setup] Using S3 endpoint: ${s3Endpoint}`);

	// Path to data directory (relative to web/admin)
	const dataDirectory = path.resolve(projectRoot, "../../data");
	log(`[S3 Setup] Data directory: ${dataDirectory}`);

	log(`[S3 Setup] Running: cargo make s3-populate-test in ${dataDirectory}`);

	try {
		log("[S3 Setup] Starting S3 population...");
		execSync("cargo make s3-populate-test", {
			cwd: dataDirectory,
			stdio: "inherit",
			env: process.env,
		});
		log("[S3 Setup] S3 population completed successfully.");
		log("[S3 Setup] ========================================");
	} catch (error) {
		log(`[S3 Setup] ERROR: Failed to populate S3: ${error}`);
		log("[S3 Setup] ========================================");
		// S3 population failure is non-fatal - tests can still run without images
		log("[S3 Setup] WARNING: Continuing without S3 test images");
	}
}

async function main() {
	// Populate database before starting the server
	await populateDatabase();

	// Populate S3 with test images
	await populateS3();

	// Start just the Vite dev server (skip docker:up and populate steps
	// since they are already handled by populateDatabase/populateS3 above)
	const command = "npm";
	const args = ["run", "dev:app"];

	log(`[Server] Starting Vite dev server: ${command} ${args.join(" ")}`);

	const server = spawn(command, args, {
		cwd: projectRoot,
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
