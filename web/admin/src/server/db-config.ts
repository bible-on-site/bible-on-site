/**
 * Default MySQL URL when `DB_URL` is unset.
 * Non-production → `tanah-dev` (populate via `npm run dev` / ensure-dev-db, prod-like copy).
 * Production → `tanah`.
 */
export function defaultMysqlDatabaseName(): string {
	return process.env.NODE_ENV === "production" ? "tanah" : "tanah-dev";
}

export function defaultMysqlUrl(): string {
	const db = defaultMysqlDatabaseName();
	return `mysql://root:test_123@localhost:3306/${db}`;
}

export function resolveMysqlUrl(): string {
	return process.env.DB_URL?.trim() || defaultMysqlUrl();
}
