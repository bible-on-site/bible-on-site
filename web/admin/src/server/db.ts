import mysql from "mysql2/promise";
import { resolveMysqlUrl } from "./db-config";

const dbUrl = resolveMysqlUrl();

// Parse the URL to extract connection parameters
const url = new URL(dbUrl);
const sslMode = url.searchParams.get("ssl-mode");

export const pool = mysql.createPool({
	host: url.hostname,
	port: Number.parseInt(url.port || "3306", 10),
	user: url.username,
	password: url.password,
	database: url.pathname.slice(1), // Remove leading slash
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0,
	ssl: sslMode === "DISABLED" ? undefined : { rejectUnauthorized: false },
});

export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
	// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string -- sql is always a parameterized literal from callers
	// biome-ignore lint/suspicious/noExplicitAny: mysql2 v3.17 narrowed QueryValues; unknown[] is not assignable to QueryValues
	const [rows] = await pool.execute(sql, (params ?? []) as any);
	return rows as T[];
}

export async function queryOne<T>(
	sql: string,
	params?: unknown[],
): Promise<T | null> {
	const rows = await query<T>(sql, params);
	return rows[0] ?? null;
}

export async function execute(
	sql: string,
	params?: unknown[],
): Promise<mysql.ResultSetHeader> {
	// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string -- sql is always a parameterized literal from callers
	// biome-ignore lint/suspicious/noExplicitAny: mysql2 v3.17 narrowed QueryValues; unknown[] is not assignable to QueryValues
	const [result] = await pool.execute(sql, (params ?? []) as any);
	return result as mysql.ResultSetHeader;
}

/** Runs `fn` inside a MySQL transaction on a dedicated pooled connection. */
export async function transaction<T>(
	fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
	const conn = await pool.getConnection();
	try {
		await conn.beginTransaction();
		const result = await fn(conn);
		await conn.commit();
		return result;
	} catch (err) {
		await conn.rollback();
		throw err;
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
	// biome-ignore lint/suspicious/noExplicitAny: mysql2 v3.17 narrowed QueryValues; unknown[] is not assignable to QueryValues
	const [rows] = await conn.execute(sql, (params ?? []) as any); // nosemgrep: javascript.lang.security.audit.db.formatted-sql-string -- sql is always a parameterized literal from callers
	return rows as T[];
}

/** `queryOne` variant bound to a transaction connection. */
export async function txQueryOne<T>(
	conn: mysql.PoolConnection,
	sql: string,
	params?: unknown[],
): Promise<T | null> {
	const rows = await txQuery<T>(conn, sql, params);
	return rows[0] ?? null;
}

/** `execute` variant bound to a transaction connection. */
export async function txExecute(
	conn: mysql.PoolConnection,
	sql: string,
	params?: unknown[],
): Promise<mysql.ResultSetHeader> {
	// biome-ignore lint/suspicious/noExplicitAny: mysql2 v3.17 narrowed QueryValues; unknown[] is not assignable to QueryValues
	const [result] = await conn.execute(sql, (params ?? []) as any); // nosemgrep: javascript.lang.security.audit.db.formatted-sql-string -- sql is always a parameterized literal from callers
	return result as mysql.ResultSetHeader;
}
