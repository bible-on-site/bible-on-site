/**
 * Database Client for server-side data fetching
 * Direct database access for lower latency and reduced billing costs
 */

import mysql, { type RowDataPacket } from "mysql2/promise";

function decodeDbComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		// Legacy connection strings can contain literal, malformed percent
		// escapes. Keep those values intact instead of rejecting the config.
		console.warn(
			"Malformed database URL component; preserving its original value",
		);
		return value;
	}
}

/**
 * Parse database URL in format: mysql://user:password@host:port/database
 */
function parseDbUrl(url: string): mysql.PoolOptions {
	const parsed = new URL(url);
	return {
		host: parsed.hostname,
		port: Number.parseInt(parsed.port || "3306", 10),
		user: decodeDbComponent(parsed.username),
		password: decodeDbComponent(parsed.password),
		database: decodeDbComponent(parsed.pathname.slice(1)), // Remove leading /
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
	}
	return pool;
}

/**
 * Execute a parameterized SQL query
 */
export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
	const connection = getPool();
	// biome-ignore lint/suspicious/noExplicitAny: mysql2 v3.17 narrowed QueryValues; safe cast from caller-provided params
	const [rows] = await connection.execute(sql, (params ?? []) as any); // nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- sql is always a parameterized literal from callers
	return rows as T[];
}

/**
 * Execute a parameterized write, returning the driver result header
 * (affectedRows/insertId) instead of a row list.
 */
export async function execute(
	sql: string,
	params?: unknown[],
): Promise<mysql.ResultSetHeader> {
	const connection = getPool();
	// biome-ignore lint/suspicious/noExplicitAny: mysql2 v3.17 narrowed QueryValues; safe cast from caller-provided params
	const [result] = await connection.execute(sql, (params ?? []) as any); // nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- sql is always a parameterized literal from callers
	return result as mysql.ResultSetHeader;
}

/** Runs `fn` inside a MySQL transaction on a dedicated pooled connection. */
export async function transaction<T>(
	fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
	const conn = await getPool().getConnection();
	try {
		await conn.beginTransaction();
		const result = await fn(conn);
		await conn.commit();
		return result;
	} catch (error) {
		await conn.rollback();
		throw error;
	} finally {
		conn.release();
	}
}

/** `query` variant bound to a transaction connection. */
export async function txQuery<T>(
	conn: mysql.PoolConnection,
	sql: string,
	params?: unknown[],
): Promise<T[]> {
	// biome-ignore lint/suspicious/noExplicitAny: mysql2 v3.17 narrowed QueryValues; safe cast from caller-provided params
	const [rows] = await conn.execute(sql, (params ?? []) as any); // nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- sql is always a parameterized literal from callers
	return rows as T[];
}

/** `query` variant returning the first row or null. */
export async function txQueryOne<T>(
	conn: mysql.PoolConnection,
	sql: string,
	params?: unknown[],
): Promise<T | null> {
	return (await txQuery<T>(conn, sql, params))[0] ?? null;
}

/** `execute` variant bound to a transaction connection. */
export async function txExecute(
	conn: mysql.PoolConnection,
	sql: string,
	params?: unknown[],
): Promise<mysql.ResultSetHeader> {
	// biome-ignore lint/suspicious/noExplicitAny: mysql2 v3.17 narrowed QueryValues; safe cast from caller-provided params
	const [result] = await conn.execute(sql, (params ?? []) as any); // nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- sql is always a parameterized literal from callers
	return result as mysql.ResultSetHeader;
}

/**
 * Runs `fn` inside a transaction holding a MySQL named lock on `lockName`.
 * The lock is released only after the transaction ends — releasing earlier
 * would let a waiter observe pre-commit state — and a dead session drops it
 * server-side, so a pooled connection can never leak it to the next borrower.
 */
export async function lockedTransaction<T>(
	lockName: string,
	fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
	const conn = await getPool().getConnection();
	let returnToPool = true;
	try {
		const [lockRows] = await conn.execute<RowDataPacket[]>(
			"SELECT GET_LOCK(?, 10) AS acquired",
			[lockName],
		);
		const raw = lockRows[0]?.acquired as number | string | null | undefined;
		const acquired = raw === null || raw === undefined ? null : Number(raw);
		if (acquired !== 1)
			throw new Error(
				acquired === 0
					? `Timed out acquiring lock ${lockName}`
					: `Failed to acquire lock ${lockName}`,
			);
		try {
			await conn.beginTransaction();
			const result = await fn(conn);
			await conn.commit();
			return result;
		} catch (error) {
			await conn.rollback();
			throw error;
		} finally {
			try {
				await conn.execute("SELECT RELEASE_LOCK(?)", [lockName]);
			} catch (error) {
				// A session that cannot release its lock must not re-enter the
				// pool still holding it; destroying drops the session (and the
				// lock server-side) so the pool replaces the connection.
				console.error(`Failed to release lock ${lockName}:`, error);
				returnToPool = false;
				conn.destroy();
			}
		}
	} finally {
		if (returnToPool) conn.release();
	}
}

/**
 * Execute a parameterized SQL query over the text protocol, with the
 * driver interpolating `?` params into the statement as escaped
 * literals (same escaping `execute` relies on).
 *
 * Needed by the search providers: a prepared `REGEXP_LIKE(col, ?)`
 * treats the pattern as a runtime value, and MySQL re-validates and
 * recompiles the ICU pattern for *every row evaluated* — on a
 * ~340k-row text scan that alone costs tens of seconds, dwarfing the
 * match work itself. With the text protocol the server sees a
 * constant pattern and compiles it once per statement, which is what
 * makes the bounded candidate scan fit its time budget (#2140). Only
 * use this where params are generated patterns — prefer `query` for
 * ordinary predicates so prepared-statement type coercion and caching
 * still apply there.
 */
export async function queryText<T>(
	sql: string,
	params?: unknown[],
): Promise<T[]> {
	const connection = getPool();
	const [rows] = await connection.query(sql, params ?? []); // nosemgrep: node-mysql-sqli -- sql is generated literals plus ? placeholders only; params are driver-escaped
	return rows as T[];
}
