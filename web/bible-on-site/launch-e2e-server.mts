/**
 * E2E Test Server Launcher
 *
 * This script populates the test database (if DB_URL is set) and then starts
 * the Next.js server for E2E tests. This approach is more reliable than using
 * Playwright's globalSetup for database operations.
 *
 * Usage: node ./launch-e2e-server.mts [--coverage] [--standalone]
 *
 * --standalone populates the database when it is missing or incomplete and
 * cargo-make is available (population is skipped where the Rust toolchain
 * was never installed, matching the pre-launcher behavior), then serves the
 * built
 * `.next/standalone/server.js` instead of `next dev`. The perf suite uses it
 * so a standalone `test:perf` run in a fresh worktree still gets its
 * per-checkout database populated (issue #2881 review).
 */

import { execSync, spawn, spawnSync } from "node:child_process";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

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
writeFileSync(
	logFile,
	`[${new Date().toISOString()}] [INIT] E2E Server Launcher started\n`,
);

// --coverage is passed by Playwright when MEASURE_COV=1; env vars come from the playwright config
const _useCoverage = process.argv.includes("--coverage");
// --standalone is passed by playwright.perf.config.ts: populate the database
// like e2e, then serve the production build instead of `next dev`.
const STANDALONE = process.argv.includes("--standalone");

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
	log("[DB Setup] DB_URL is configured");

	// --standalone runs can point at a database an earlier step already
	// populated — the Website Performance job populates tanah_test for the
	// production build, and mysql-populate is not idempotent (it dies on
	// duplicate keys). Verify first and populate only a missing or
	// incomplete database; a fresh local worktree's derived per-checkout
	// database gets created by that populate (issue #2881 review).
	if (STANDALONE) {
		try {
			await verifyTestDatabase(dbUrl);
			log(
				"[DB Setup] Database already populated — skipping cargo make mysql-populate.",
			);
			return;
		} catch (error) {
			log(
				`[DB Setup] Database missing or incomplete (${
					error instanceof Error ? error.message : error
				}) — populating.`,
			);
		}
	}

	// Path to data directory (relative to web/bible-on-site)
	const dataDirectory = path.resolve(__dirname, "../../data");
	log(`[DB Setup] Data directory: ${dataDirectory}`);

	// Check if cargo-make is available
	const cargoMakeCheck = spawnSync("cargo", ["make", "--version"], {
		stdio: "pipe",
	});

	if (cargoMakeCheck.status !== 0) {
		log(
			`[DB Setup] cargo-make check failed with status: ${cargoMakeCheck.status}`,
		);
		log(`[DB Setup] stderr: ${cargoMakeCheck.stderr?.toString()}`);
		// Standalone (perf) runs may execute where the Rust toolchain was never
		// installed — e.g. the Website Performance job skips MySQL/cargo-make
		// when perushim data is unavailable. The production server tolerates a
		// missing or empty database the same way it did before the launcher
		// owned population, so skip rather than fail the whole suite.
		if (STANDALONE) {
			log(
				"[DB Setup] cargo-make unavailable — skipping population; the standalone server will use the existing database.",
			);
			return;
		}
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
	} catch (error) {
		log(`[DB Setup] ERROR: Failed to populate database: ${error}`);
		log("[DB Setup] ========================================");
		throw new Error(
			"Database population failed. E2E tests require a populated database.",
		);
	}

	// Health check: verify all expected tables exist and have data.
	// This catches silent failures (missing SQL files, skipped optional steps,
	// wrong database name, etc.) early — before tests run and produce
	// confusing "element not found" errors.
	await verifyTestDatabase(dbUrl);
	log("[DB Setup] ========================================");
}

/**
 * Verify that the test database has all required tables with data.
 * Uses the app's mysql2 dependency so local and CI runs don't depend on a
 * separately installed mysql CLI.
 */
async function verifyTestDatabase(dbUrl: string): Promise<void> {
	log("[DB Health] Verifying test database tables...");

	const url = new URL(dbUrl);
	const database = url.pathname.slice(1);
	const { default: mysql } = await import("mysql2/promise");
	const connection = await mysql.createConnection({
		host: url.hostname,
		port: Number.parseInt(url.port || "3306", 10),
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database,
	});

	// Tables that must exist and contain at least 1 row for e2e tests to pass.
	// When adding a new feature that queries a new table, add it here!
	const requiredTables = [
		"tanah_author",
		"tanah_article",
		"tanah_perek",
		"tanah_sefer",
		"parshan",
		"perush",
		"note",
	];
	// A perek may legitimately have no illustration, but the schema is required.
	const optionalContentTables = [
		"tanah_perek_image",
		"tanah_perek_image_variant",
	];

	const missing: string[] = [];
	const empty: string[] = [];

	try {
		for (const table of requiredTables) {
			try {
				const [rows] = await connection.execute(
					`SELECT COUNT(*) AS row_count FROM \`${table}\``,
				);
				const [{ row_count: rowCount }] = rows as { row_count: number }[];
				const count = Number(rowCount);
				if (count === 0) {
					empty.push(table);
				}
			} catch {
				missing.push(table);
			}
		}
		for (const table of optionalContentTables) {
			try {
				await connection.execute(`SELECT COUNT(*) FROM \`${table}\``);
			} catch {
				missing.push(table);
			}
		}
	} finally {
		await connection.end();
	}

	if (missing.length > 0 || empty.length > 0) {
		const parts: string[] = [];
		if (missing.length > 0) parts.push(`missing tables: ${missing.join(", ")}`);
		if (empty.length > 0) parts.push(`empty tables: ${empty.join(", ")}`);
		const msg = `[DB Health] FAILED — ${parts.join("; ")} in database '${database}'`;
		log(msg);
		throw new Error(
			`${msg}. Either the db-populator didn't populate these tables, ` +
				`or the app is connecting to the wrong database. ` +
				`Check DB_URL and tanah_test_data.sql.`,
		);
	}

	log(
		`[DB Health] All ${requiredTables.length} required tables verified in '${database}'.`,
	);
}

async function main() {
	// Populate database before starting the server
	await populateDatabase();

	// Clear Next.js data cache to avoid stale unstable_cache entries from
	// previous dev runs that may have used a different database.
	// Dev mode (Turbopack) stores fetch cache under .next/dev/cache/fetch-cache/
	// while production stores it under .next/cache/fetch-cache/
	for (const cacheSubDir of [
		".next/dev/cache/fetch-cache",
		".next/cache/fetch-cache",
	]) {
		const cacheDir = path.resolve(__dirname, cacheSubDir);
		if (existsSync(cacheDir)) {
			log(`[Cache] Clearing stale data cache at ${cacheDir}`);
			rmSync(cacheDir, { recursive: true, force: true });
		}
	}

	// Start the Next.js server directly (bypass predev hook which switches
	// flip-book to local and runs docker compose — both break in CI)
	// Always use `next dev` for e2e so tests pass: standalone can throw NoFallbackError
	// on some routes; coverage also requires dev (instrumentation). No pre-build needed.
	//
	// --standalone serves the production build instead: the perf suite measures
	// the artifact CI ships, and its webServer.env already carries PORT and
	// HOSTNAME for `.next/standalone/server.js`.
	let serverArgs: string[];
	let serverDescription: string;
	if (STANDALONE) {
		serverArgs = [path.resolve(__dirname, ".next/standalone/server.js")];
		serverDescription = "node .next/standalone/server.js";
	} else {
		// The Playwright config passes the suite's port as WEB_PORT so parallel
		// local sessions never share :3001 (issue #2881); manual runs keep :3001.
		const webPort = process.env.WEB_PORT?.trim();
		const port = webPort ? Number(webPort) : 3001;
		if (!Number.isInteger(port) || port < 1 || port > 65_535) {
			throw new Error(
				`WEB_PORT must be an integer between 1 and 65535, got "${webPort}"`,
			);
		}
		serverArgs = [
			require.resolve("next/dist/bin/next"),
			"dev",
			"-p",
			String(port),
		];
		serverDescription = `node next dev -p ${port}`;
	}
	log(`[Server] Starting ${serverDescription}`);

	// Tee the dev server's stdout/stderr into the artifact so CI failures keep
	// the `⨯` lines Playwright's webServer pipe would otherwise discard (#2005).
	const serverLogPath = path.resolve(logDir, "server.log");
	const serverLog = createWriteStream(serverLogPath, { flags: "w" });

	const server = spawn(process.execPath, serverArgs, {
		cwd: __dirname,
		stdio: ["inherit", "pipe", "pipe"],
		env: process.env,
	});

	server.stdout?.on("data", (chunk: Buffer) => {
		process.stdout.write(chunk);
		serverLog.write(chunk);
	});
	server.stderr?.on("data", (chunk: Buffer) => {
		process.stderr.write(chunk);
		serverLog.write(chunk);
	});

	server.on("error", (err) => {
		log(`[Server] Error: ${err.message}`);
		process.exit(1);
	});

	server.on("close", (code) => {
		serverLog.end();
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
