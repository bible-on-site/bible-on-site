/**
 * Database Client for server-side data fetching
 * Direct database access for lower latency and reduced billing costs
 */

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
// Supports both DB_URL (connection string) and individual env vars
function getDbConfig(): mysql.PoolOptions {
	if (process.env.DB_URL) {
		return parseDbUrl(process.env.DB_URL);
	}
	return {
		host: process.env.DB_HOST || "127.0.0.1",
		port: Number.parseInt(process.env.DB_PORT || "3306", 10),
		user: process.env.DB_USER || "root",
		password: process.env.DB_PASSWORD || "",
		database: process.env.DB_NAME || "tanah",
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
			connectionLimit: 10,
			queueLimit: 0,
		});
	}
	return pool;
}

/**
 * Execute a parameterized SQL query
 */
export async function query<T>(
	sql: string,
	params?: unknown[],
): Promise<T[]> {
	const connection = getPool();
	const [rows] = await connection.execute(sql, params);
	return rows as T[];
}
