/**
 * Database Client for server-side data fetching
 * Direct database access for lower latency and reduced billing costs
 */

import type { Connection as CoreConnection } from "mysql2";
import mysql from "mysql2/promise";

/**
 * Parse database URL in format: mysql://user:password@host:port/database
 */
function parseDbUrl(url: string): mysql.PoolOptions {
	const parsed = new URL(url);
	return {
		host: parsed.hostname,
		port: Number.parseInt(parsed.port || "3306", 10),
		user: parsed.username,
		password: parsed.password,
		database: parsed.pathname.slice(1), // Remove leading /
	};
}

// Database configuration from environment variables
// Supports both DB_URL (connection string) and individual env vars.
// When DB_URL is set explicitly, it is always respected as-is — no overrides.
// When using individual env vars, the default database name depends on NODE_ENV.
function getDbConfig(): mysql.PoolOptions {
	if (process.env.DB_URL) {
		return parseDbUrl(process.env.DB_URL);
	}
	const defaultDb =
		process.env.NODE_ENV === "development" ? "tanah-dev" : "tanah";
	return {
		host: process.env.DB_HOST || "127.0.0.1",
		port: Number.parseInt(process.env.DB_PORT || "3306", 10),
		user: process.env.DB_USER || "root",
		password: process.env.DB_PASSWORD || "",
		database: process.env.DB_NAME || defaultDb,
	};
}

let pool: mysql.Pool | null = null;

/**
 * Get or create a connection pool for database queries
 */
function getPool(): mysql.Pool {
	if (!pool) {
		pool = mysql.createPool({
			...getDbConfig(),
			waitForConnections: true,
			connectionLimit: 5,
			queueLimit: 0,
		});
		// Search providers run normalization-aware REGEXP_LIKE scans over
		// an unindexed ~50k-row text column. A single match attempt on a
		// very long row can exhaust the engine's per-match step budget
		// (MySQL error 3699, `regexp_time_limit`, default 32) well before
		// the statement's own MAX_EXECUTION_TIME hint — which is the
		// intended wall-clock bound — fires. Raise the per-match budget
		// high enough that the statement hint is always the limiting
		// factor (#2140).
		pool.on("connection", (connection) => {
			// The pool emits the core callback-API connection here, not a
			// promise wrapper, so the session variable is set with a callback.
			(connection as unknown as CoreConnection).query(
				"SET SESSION regexp_time_limit = 16777216",
				(err) => {
					if (err) {
						console.error("[db] regexp_time_limit session setup failed:", err);
					}
				},
			);
		});
	}
	return pool;
}

/**
 * Execute a parameterized SQL query
 */
export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
	const connection = getPool();
	// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string -- sql is always a parameterized literal from callers
	// biome-ignore lint/suspicious/noExplicitAny: mysql2 v3.17 narrowed QueryValues; safe cast from caller-provided params
	const [rows] = await connection.execute(sql, (params ?? []) as any);
	return rows as T[];
}
