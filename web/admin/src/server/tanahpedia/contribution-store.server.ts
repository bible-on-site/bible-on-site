import type { PoolConnection } from "mysql2/promise";
import type { Contribution } from "~/lib/tanahpedia/contributions";
import { execute, query, transaction, txExecute, txQueryOne } from "../db";

// DDL is outside transactions: MySQL implicitly commits schema statements.
// IF NOT EXISTS preserves review history across restarts and repeat deployments.
export const CONTRIBUTION_SCHEMA = `CREATE TABLE IF NOT EXISTS tanahpedia_contribution (
	id CHAR(36) NOT NULL PRIMARY KEY,
	number BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
	kind VARCHAR(8) NOT NULL,
	state VARCHAR(12) NOT NULL,
	title VARCHAR(255) NOT NULL,
	issue_id CHAR(36) NULL,
	version INT UNSIGNED NOT NULL DEFAULT 1,
	data JSON NOT NULL,
	created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
	KEY idx_contribution_queue (kind, state, number),
	KEY idx_contribution_issue (issue_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

let schemaPromise: Promise<unknown> | undefined;
export async function ensureContributionSchema(): Promise<void> {
	schemaPromise ??= execute(CONTRIBUTION_SCHEMA).catch((error: unknown) => {
		schemaPromise = undefined;
		throw error;
	});
	await schemaPromise;
}

interface ContributionRow {
	id: string;
	number: number;
	kind: Contribution["kind"];
	state: Contribution["state"];
	title: string;
	version: number;
	data: string | Contribution;
}

function decode(row: ContributionRow): Contribution {
	const data: Contribution =
		typeof row.data === "string" ? JSON.parse(row.data) : row.data;
	return {
		...data,
		id: row.id,
		number: Number(row.number),
		kind: row.kind,
		state: row.state,
		title: row.title,
		version: row.version,
	};
}

export async function readContribution(
	conn: PoolConnection,
	id: string,
	lock = false,
): Promise<Contribution> {
	const row = await txQueryOne<ContributionRow>(
		conn,
		`SELECT id, number, kind, state, title, version, data FROM tanahpedia_contribution WHERE id = ?${lock ? " FOR UPDATE" : ""}`,
		[id],
	);
	if (!row) throw new Error("Issue or PR not found");
	return decode(row);
}

export async function insertContribution(
	conn: PoolConnection,
	item: Contribution,
): Promise<Contribution> {
	await txExecute(
		conn,
		"INSERT INTO tanahpedia_contribution (id, kind, state, title, issue_id, version, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
		[
			item.id,
			item.kind,
			item.state,
			item.title,
			item.issueId,
			item.version,
			JSON.stringify(item),
		],
	);
	return readContribution(conn, item.id);
}

export async function saveContribution(
	conn: PoolConnection,
	item: Contribution,
): Promise<Contribution> {
	const previousVersion = item.version;
	item.version += 1;
	item.updatedAt = new Date().toISOString();
	const result = await txExecute(
		conn,
		"UPDATE tanahpedia_contribution SET state = ?, title = ?, version = ?, data = ? WHERE id = ? AND version = ?",
		[
			item.state,
			item.title,
			item.version,
			JSON.stringify(item),
			item.id,
			previousVersion,
		],
	);
	if (result.affectedRows !== 1)
		throw new Error("The issue or PR changed. Reload before retrying.");
	return item;
}

export async function listContributions(): Promise<Contribution[]> {
	await ensureContributionSchema();
	const rows = await query<ContributionRow>(
		"SELECT id, number, kind, state, title, version, data FROM tanahpedia_contribution ORDER BY number DESC LIMIT 500",
	);
	return rows.map(decode);
}

export async function withContributions<T>(
	fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
	await ensureContributionSchema();
	return transaction(fn);
}
