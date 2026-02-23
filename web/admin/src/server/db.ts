import mysql from "mysql2/promise";

const dbUrl =
	process.env.DB_URL || "mysql://root:test_123@localhost:3306/tanah";

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
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mysql2 v3.17 narrowed QueryValues
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
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mysql2 v3.17 narrowed QueryValues
	const [result] = await pool.execute(sql, (params ?? []) as any);
	return result as mysql.ResultSetHeader;
}
