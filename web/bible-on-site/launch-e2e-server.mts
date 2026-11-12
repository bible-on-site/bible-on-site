/**
 * E2E Test Server Launcher
 *
 * This script populates the test database (if DB_URL is set) and then starts
 * the Next.js server for E2E tests. This approach is more reliable than using
 * Playwright's globalSetup for database operations.
 *
 * Usage: node ./launch-e2e-server.mts [--coverage] [--standalone] [--record-populate-marker]
 *
 * --standalone populates the database like e2e when cargo-make is available
 * (population is skipped where the Rust toolchain was never installed,
 * matching the pre-launcher behavior), then serves the built
 * `.next/standalone/server.js` instead of `next dev`. The perf suite uses it
 * so a standalone `test:perf` run in a fresh worktree still gets its
 * per-checkout database populated (issue #2881 review).
 *
 * --record-populate-marker verifies DB_URL and records the current
 * populate-input hash without starting a server. CI populate steps that run
 * `cargo make mysql-populate` outside the launcher (e.g. before `next build`)
 * use it so the perf webServer reuses that population instead of rebuilding.
 */

import { execSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { readdir, readFile } from "node:fs/promises";
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

type LogLevel = "info" | "warn" | "error";

function log(message: string, level: LogLevel = "info"): void {
	const timestamp = new Date().toISOString();
	const line = `[${timestamp}] ${message}\n`;
	if (level === "error") {
		console.error(message);
	} else if (level === "warn") {
		console.warn(message);
	} else {
		console.log(message);
	}
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
// --record-populate-marker is used by CI populate steps that run
// `cargo make mysql-populate` outside the launcher so the perf webServer can
// reuse that population instead of rebuilding the database.
const RECORD_MARKER = process.argv.includes("--record-populate-marker");

// Records which populate inputs built the target database so --standalone
// can skip mysql-populate only when they are unchanged. Declared before
// `await main()` — const bindings are not hoisted past it.
const POPULATE_MARKER_TABLE = "test_populate_marker";

try {
	await main();
} catch (err) {
	log(`[ERROR] ${err}`, "error");
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

	// --standalone reuses a database only when it was populated from the
	// exact current inputs: the marker is written after the post-populate
	// verification, so a match means schema and fixtures are current. Any
	// populate-input change (SQL, populator code, deps, the cargo-make task)
	// forces a rebuild instead of measuring a stale schema (#3251 review).
	let inputsHash: string | undefined;
	if (STANDALONE) {
		inputsHash = await populateInputsHash();
		if ((await readPopulateMarker(dbUrl)) === inputsHash) {
			try {
				await verifyTestDatabase(dbUrl);
				log(
					"[DB Setup] Database already populated from the current inputs — skipping cargo make mysql-populate.",
				);
				return;
			} catch {
				log(
					"[DB Setup] Marker matched but verification failed — repopulating.",
					"warn",
				);
			}
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
			"error",
		);
		log(`[DB Setup] stderr: ${cargoMakeCheck.stderr?.toString()}`, "error");
		// Standalone (perf) runs may execute where the Rust toolchain was never
		// installed — e.g. the Website Performance job skips MySQL/cargo-make
		// when perushim data is unavailable. The production server tolerates a
		// missing or empty database the same way it did before the launcher
		// owned population, so skip rather than fail the whole suite.
		if (STANDALONE) {
			log(
				"[DB Setup] cargo-make unavailable — skipping population; the standalone server will use the existing database.",
				"warn",
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
		log(`[DB Setup] ERROR: Failed to populate database: ${error}`, "error");
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
	if (STANDALONE && inputsHash) {
		try {
			await writePopulateMarker(dbUrl, inputsHash);
		} catch (error) {
			log(`[DB Setup] Could not record populate marker: ${error}`, "warn");
		}
	}
	log("[DB Setup] ========================================");
}

async function connectTestDatabase(dbUrl: string) {
	const url = new URL(dbUrl);
	const { default: mysql } = await import("mysql2/promise");
	return mysql.createConnection({
		host: url.hostname,
		port: Number.parseInt(url.port || "3306", 10),
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database: url.pathname.slice(1),
	});
}

/**
 * Hash every input that determines the populated schema and fixtures, so
 * --standalone can reuse a database only when it was built from exactly
 * these files. Any populate-input change (SQL, populator code, deps, the
 * cargo-make task) forces a rebuild instead of measuring a stale schema.
 */
async function populateInputsHash(): Promise<string> {
	const dataDirectory = path.resolve(__dirname, "../../data");
	const mysqlDirectory = path.join(dataDirectory, "mysql");
	const inputs = [
		...(await readdir(mysqlDirectory))
			.filter((name) => name.endsWith(".sql"))
			.map((name) => path.join(mysqlDirectory, name)),
		path.join(mysqlDirectory, "db-populator", "src", "main.rs"),
		path.join(mysqlDirectory, "db-populator", "Cargo.toml"),
		path.join(dataDirectory, "Cargo.toml"),
		path.join(dataDirectory, "Cargo.lock"),
		path.join(dataDirectory, "Makefile.toml"),
	].sort();
	const hash = createHash("sha256");
	for (const input of inputs) {
		hash.update(path.relative(dataDirectory, input));
		hash.update(await readFile(input));
	}
	return hash.digest("hex");
}

/** Returns the populate-input hash recorded in the database, or null. */
async function readPopulateMarker(dbUrl: string): Promise<string | null> {
	try {
		const connection = await connectTestDatabase(dbUrl);
		try {
			const [rows] = await connection.execute(
				`SELECT sql_hash FROM \`${POPULATE_MARKER_TABLE}\` WHERE id = 1`,
			);
			return (rows as { sql_hash: string }[])[0]?.sql_hash ?? null;
		} finally {
			await connection.end();
		}
	} catch {
		// Missing database or marker table means "never populated here".
		return null;
	}
}

async function writePopulateMarker(
	dbUrl: string,
	inputsHash: string,
): Promise<void> {
	const connection = await connectTestDatabase(dbUrl);
	try {
		await connection.execute(
			`CREATE TABLE IF NOT EXISTS \`${POPULATE_MARKER_TABLE}\` (
				id TINYINT NOT NULL PRIMARY KEY,
				sql_hash CHAR(64) NOT NULL,
				populated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		);
		await connection.execute(
			`INSERT INTO \`${POPULATE_MARKER_TABLE}\` (id, sql_hash)
			 VALUES (1, ?) ON DUPLICATE KEY UPDATE sql_hash = VALUES(sql_hash)`,
			[inputsHash],
		);
	} finally {
		await connection.end();
	}
}

/**
 * Verify that the test database has all required tables with data.
 * Uses the app's mysql2 dependency so local and CI runs don't depend on a
 * separately installed mysql CLI.
 */
async function verifyTestDatabase(dbUrl: string): Promise<void> {
	log("[DB Health] Verifying test database tables...");

	const database = new URL(dbUrl).pathname.slice(1);
	const connection = await connectTestDatabase(dbUrl);

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
		log(msg, "error");
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
	if (RECORD_MARKER) {
		const dbUrl = process.env.DB_URL;
		if (!dbUrl) {
			throw new Error("--record-populate-marker requires DB_URL");
		}
		// Verify before marking so a broken population is never recorded as
		// current — the perf webServer trusts the marker and would skip its
		// own populate + verification.
		await verifyTestDatabase(dbUrl);
		await writePopulateMarker(dbUrl, await populateInputsHash());
		log("[DB Setup] Recorded populate marker for the current inputs.");
		return;
	}

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
		log(`[Server] Error: ${err.message}`, "error");
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
