import type { PoolConnection } from "mysql2/promise";
import {
	type Contribution,
	type ContributionListRequest,
	type ContributionPage,
	validateContributionList,
} from "~/lib/tanahpedia/contributions";
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

export const CONTRIBUTION_AGENT_SCHEMA = `CREATE TABLE IF NOT EXISTS tanahpedia_contribution_agent (
	id CHAR(36) NOT NULL PRIMARY KEY,
	version INT UNSIGNED NOT NULL DEFAULT 1,
	data JSON NOT NULL,
	created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

export const CONTRIBUTION_AGENT_BUNDLE_SCHEMA = `CREATE TABLE IF NOT EXISTS tanahpedia_contribution_agent_bundle (
	hash CHAR(64) NOT NULL PRIMARY KEY,
	version VARCHAR(100) NOT NULL,
	data JSON NOT NULL,
	created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

export const ARTICLE_LINK_IMPORT_SCHEMA = `CREATE TABLE IF NOT EXISTS tanahpedia_article_link_import (
	proposal_id CHAR(36) NOT NULL PRIMARY KEY,
	contribution_id CHAR(36) NOT NULL,
	article_id INT NOT NULL,
	original JSON NOT NULL,
	created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	KEY idx_article_link_import_pr (contribution_id),
	KEY idx_article_link_import_article (article_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

export const ARTICLE_LINK_IMPORT_LOCK_SCHEMA = `CREATE TABLE IF NOT EXISTS tanahpedia_article_link_import_lock (
	article_id INT NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

let schemaPromise: Promise<unknown> | undefined;
export async function ensureContributionSchema(): Promise<void> {
	schemaPromise ??= (async () => {
		await execute(CONTRIBUTION_SCHEMA);
		await execute(CONTRIBUTION_AGENT_SCHEMA);
		await execute(CONTRIBUTION_AGENT_BUNDLE_SCHEMA);
		await execute(ARTICLE_LINK_IMPORT_SCHEMA);
		await execute(ARTICLE_LINK_IMPORT_LOCK_SCHEMA);
	})().catch((error: unknown) => {
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

export async function listContributions(
	raw: ContributionListRequest = {},
): Promise<ContributionPage> {
	await ensureContributionSchema();
	const input = validateContributionList(raw),
		where: string[] = [],
		bodyFilters: string[] = [],
		values: (string | number)[] = [];
	if (input.kind) {
		where.push("kind = ?");
		values.push(input.kind);
	}
	if (input.assignee) {
		bodyFilters.push("JSON_UNQUOTE(JSON_EXTRACT(data, '$.assignee.kind')) = ?");
		values.push(input.assignee);
	}
	if (input.q) {
		bodyFilters.push(
			"LOCATE(LOWER(?), LOWER(CONCAT_WS(' ', title, number, JSON_UNQUOTE(JSON_EXTRACT(data, '$.description')), JSON_UNQUOTE(JSON_EXTRACT(data, '$.author.name')), JSON_UNQUOTE(JSON_EXTRACT(data, '$.assignee.name')), JSON_UNQUOTE(JSON_EXTRACT(data, '$.assignee.id')), REPLACE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.assignee.kind')), '_', ' '), CASE JSON_UNQUOTE(JSON_EXTRACT(data, '$.assignee.kind')) WHEN 'unassigned' THEN 'ללא שיוך' WHEN 'human' THEN 'עורך אנושי' ELSE '' END))) > 0",
		);
		values.push(input.q);
	}
	if (bodyFilters.length) {
		// JSON predicates would otherwise make MySQL carry the body into the sort.
		where.push(
			`(SELECT ${bodyFilters.join(" AND ")}
			 FROM tanahpedia_contribution AS body
			 WHERE body.number = candidate.number LIMIT 1)`,
		);
	}
	if (input.relatedTo) {
		where.push(
			"(id = ? OR issue_id = ? OR id = (SELECT issue_id FROM tanahpedia_contribution related WHERE related.id = ?))",
		);
		values.push(input.relatedTo, input.relatedTo, input.relatedTo);
	}
	const base = where.length ? where.join(" AND ") : "1 = 1";
	const [totals] = await query<{ open: number; closed: number; all: number }>(
		`SELECT COALESCE(SUM(state = 'open'),0) AS open, COALESCE(SUM(state <> 'open'),0) AS closed, COUNT(*) AS \`all\` FROM tanahpedia_contribution AS candidate WHERE ${base}`,
		[...values],
	);
	const [global] = await query<{ issues: number; prs: number }>(
		"SELECT COALESCE(SUM(kind = 'issue' AND state = 'open'),0) AS issues, COALESCE(SUM(kind = 'pr' AND state = 'open'),0) AS prs FROM tanahpedia_contribution",
	);
	if (input.state && input.state !== "all")
		where.push(input.state === "open" ? "state = 'open'" : "state <> 'open'");
	if (input.before) {
		where.push("number < ?");
		values.push(input.before);
	}
	// The bounded derived table sorts narrow keys before reading contribution JSON.
	const rows = await query<ContributionRow>(
		`SELECT c.id, c.number, c.kind, c.state, c.title, c.version, c.data
		 FROM (
			 SELECT number FROM tanahpedia_contribution AS candidate
			 WHERE ${where.length ? where.join(" AND ") : "1 = 1"}
			 ORDER BY number DESC LIMIT 101
		 ) AS page
		 JOIN tanahpedia_contribution AS c ON c.number = page.number`,
		values,
	);
	// The outer join has no ORDER BY, so restore the bounded page order here.
	rows.sort((a, b) => Number(b.number) - Number(a.number));
	const items = rows.slice(0, 100).map(decode);
	return {
		items,
		nextCursor: rows.length > 100 ? items[items.length - 1].number : null,
		counts: {
			issues: Number(global.issues),
			prs: Number(global.prs),
			open: Number(totals.open),
			closed: Number(totals.closed),
			all: Number(totals.all),
		},
	};
}

export async function withContributions<T>(
	fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
	await ensureContributionSchema();
	return transaction(fn);
}
