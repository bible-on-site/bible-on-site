/**
 * E2E Test Server Launcher for Admin App
 *
 * Environment comes from the npm script wrapper
 * (`dotenv -e .test.env -- playwright test`) or from CI env vars directly.
 *
 * This script:
 * 1. Populates the test database (when DB_URL is set)
 * 2. Populates the S3 test bucket (when S3_ENDPOINT is set)
 * 3. Starts the Vite dev server for E2E tests
 *
 * With MEASURE_COV=1 the Vite plugin instruments app modules; coverage is
 * collected via the test fixture and /api/dev/coverage — no launcher plumbing
 * needed beyond env propagation.
 *
 * Usage: node --import tsx ./tests/util/launch-e2e-server.mts
 */

import { execSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);

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
 * Runs a population npm script (`db:populate:test` / `s3:populate:test`),
 * which delegates to the matching `cargo make` task in data/.
 */
function runPopulate(script: string, label: string, fatal: boolean): void {
	log(`[${label} Setup] Running: npm run ${script}`);
	try {
		execSync(`npm run ${script}`, {
			cwd: projectRoot,
			stdio: "inherit",
			env: process.env,
		});
		log(`[${label} Setup] Population completed successfully.`);
	} catch (error) {
		log(`[${label} Setup] ERROR: population failed: ${error}`);
		if (fatal) {
			throw new Error(
				`${label} population failed. Admin E2E tests require a populated database.`,
			);
		}
		// S3 population failure is non-fatal - tests can still run without images
		log(`[${label} Setup] WARNING: Continuing without ${label} test data`);
	}
}

async function main(): Promise<void> {
	if (process.env.DB_URL) {
		log(
			`[DB Setup] Populating test database: ${process.env.DB_URL.replace(/:[^:@]+@/, ":***@")}`,
		);
		runPopulate("db:populate:test", "DB", true);
	} else {
		log("[DB Setup] DB_URL not set, skipping database population");
	}

	if (process.env.S3_ENDPOINT) {
		log(`[S3 Setup] Populating S3 bucket at ${process.env.S3_ENDPOINT}`);
		runPopulate("s3:populate:test", "S3", false);
	} else {
		log("[S3 Setup] S3_ENDPOINT not set, skipping S3 population");
	}

	// Inherits env so MEASURE_COV reaches vite.config.ts (istanbul instrumentation).
	log("[Server] Starting Vite dev server: npm run dev:app");
	const server = spawn("npm", ["run", "dev:app"], {
		cwd: projectRoot,
		stdio: "inherit",
		env: process.env,
		shell: true,
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
