import { createServerFn } from "@tanstack/react-start";
import type mysql from "mysql2/promise";
import {
	assertCoveringSourcesExist,
	type CoveringSource,
	isCoveringSourceSchemaMissing,
	normalizeCoveringSources,
	replaceCoveringSources,
	updateCoverageVerified,
} from "./covering-sources";
import {
	execute,
	query,
	queryOne,
	transaction,
	txExecute,
	txQuery,
	txQueryOne,
} from "./db";
import { recomputeArticleMetrics } from "./reading-metrics";
import {
	articleInvalidation,
	articlePath,
	revalidateWebsite,
} from "./website-revalidate";

/**
 * Derived article-search index sync. Every article write enqueues the article
 * id into `article_search_queue` (same DDL as the Rust API's ensure_schema) in
 * the SAME transaction, so the enqueue commits atomically with the content
 * write — never silently lost, never pointing at a rolled-back row. The API
 * worker drains the queue; its periodic reconcile sweep catches even missed
 * enqueues via content hashes, so this is the fast path, not the only path.
 */
const ENSURE_SEARCH_QUEUE_SQL = `CREATE TABLE IF NOT EXISTS article_search_queue (
	article_id MEDIUMINT NOT NULL PRIMARY KEY,
	queued_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	last_error VARCHAR(240) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const ENQUEUE_SEARCH_SQL = `INSERT INTO article_search_queue (article_id) VALUES (?)
	ON DUPLICATE KEY UPDATE queued_at = CURRENT_TIMESTAMP(6), attempts = 0, last_error = NULL`;

let searchQueueReady: Promise<void> | null = null;

/**
 * Creates the queue table lazily (once per process) — outside transactions,
 * because MySQL DDL implicitly commits. A failed ensure clears the cache so
 * the next write retries.
 */
function ensureArticleSearchQueue(): Promise<void> {
	searchQueueReady ??= execute(ENSURE_SEARCH_QUEUE_SQL)
		.then(() => undefined)
		.catch((err: unknown) => {
			searchQueueReady = null;
			throw err;
		});
	return searchQueueReady;
}

/** Test hook: resets the memoized ensure so tests re-run it. */
export function _resetArticleSearchQueueCache(): void {
	searchQueueReady = null;
}

export interface Article {
	id: number;
	perek_id: number;
	author_id: number;
	abstract: string | null;
	name: string;
	priority: number;
	distributable: boolean;
	/**
	 * Verified verse-level coverage state (#2189): TRUE means the
	 * coveringSources rows are the article's verified coverage and drive
	 * verse/range lookups; FALSE means coverage is unknown and consumers
	 * fall back to the primary perek association. FALSE is also returned
	 * when the covering-source schema is not deployed yet.
	 */
	coverage_verified: boolean;
	/**
	 * The article's persisted covering sources, ordered by coordinate.
	 * `undefined` means the covering-source schema is not deployed — never
	 * "the article covers no pesukim"; an explicitly empty array means no
	 * rows are mapped (coverage unknown or cleared).
	 */
	coveringSources?: CoveringSource[];
	/**
	 * Number of covering-source rows, populated by the list queries for
	 * review badges; `undefined` when the schema is not deployed.
	 */
	covering_count?: number;
	content?: string | null;
	author_name?: string; // Populated when joined with authors table
}

export interface ArticleFormData {
	perek_id: number;
	author_id: number;
	abstract: string;
	name: string;
	priority: number;
	distributable: boolean;
	content: string;
	/**
	 * Covering-source update semantics:
	 * - omitted: coverage state is left untouched — older clients and
	 *   unrelated edits can never wipe mappings.
	 * - array (including []): atomically replaces the persisted set after
	 *   coordinate/duplicate/existence validation; `coverageVerified`
	 *   decides the verified flag for the new set.
	 * - `coverageVerified` alone toggles the flag on the persisted set;
	 *   TRUE requires at least one stored covering row.
	 */
	coveringSources?: CoveringSource[];
	coverageVerified?: boolean;
}

const ARTICLE_COLUMNS =
	"id, perek_id, author_id, abstract, name, priority, distributable";
const ARTICLE_COVERAGE_COLUMNS = `${ARTICLE_COLUMNS}, coverage_verified`;
const ARTICLE_COVERAGE_COLUMNS_JOINED =
	"a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority, a.distributable, a.coverage_verified";
const ARTICLE_COLUMNS_JOINED =
	"a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority, a.distributable";
const ARTICLE_COVERING_COUNT_SQL =
	"(SELECT COUNT(*) FROM tanah_article_covering_source cs WHERE cs.article_id = a.id) AS covering_count";

type ArticleRow = Omit<Article, "coveringSources">;

/**
 * Loads the article's persisted covering sources. Returns undefined when
 * the covering-source table is not deployed — distinct from an explicitly
 * empty set — so save round-trips omit the field instead of wiping.
 */
async function loadCoveringSources(
	articleId: number,
): Promise<CoveringSource[] | undefined> {
	try {
		return await query<CoveringSource>(
			"SELECT perek_id, pasuk FROM tanah_article_covering_source WHERE article_id = ? ORDER BY perek_id, pasuk",
			[articleId],
		);
	} catch (error) {
		if (!isCoveringSourceSchemaMissing(error)) throw error;
		return undefined;
	}
}

/**
 * Loads covering sources inside a save transaction for the read-back of a
 * just-written article; undefined when the schema is not deployed.
 */
async function txLoadCoveringSources(
	conn: mysql.PoolConnection,
	articleId: number,
): Promise<CoveringSource[] | undefined> {
	try {
		return await txQuery<CoveringSource>(
			conn,
			"SELECT perek_id, pasuk FROM tanah_article_covering_source WHERE article_id = ? ORDER BY perek_id, pasuk",
			[articleId],
		);
	} catch (error) {
		if (!isCoveringSourceSchemaMissing(error)) throw error;
		return undefined;
	}
}

type ArticleQueryOne = (
	sql: string,
	params?: unknown[],
) => Promise<ArticleRow | null>;

/**
 * Selects an article including coverage_verified; degrades to the
 * pre-upgrade column list (coverage reported as unverified) when the
 * column does not exist yet, so edits keep working before the deploy.
 */
async function queryArticleRow(
	queryOneFn: ArticleQueryOne,
	id: number,
): Promise<ArticleRow | null> {
	try {
		const row = await queryOneFn(
			`SELECT ${ARTICLE_COVERAGE_COLUMNS}, content FROM tanah_article WHERE id = ?`,
			[id],
		);
		return row;
	} catch (error) {
		if (!isCoveringSourceSchemaMissing(error)) throw error;
		const row = await queryOneFn(
			`SELECT ${ARTICLE_COLUMNS}, content FROM tanah_article WHERE id = ?`,
			[id],
		);
		return row ? { ...row, coverage_verified: false } : null;
	}
}

// Get all articles (without content for performance)
export const getArticles = createServerFn({ method: "GET" }).handler(
	async () => {
		try {
			return await query<ArticleRow>(
				`SELECT ${ARTICLE_COVERAGE_COLUMNS_JOINED}, ${ARTICLE_COVERING_COUNT_SQL} FROM tanah_article a ORDER BY a.perek_id, a.priority`,
			);
		} catch (error) {
			if (!isCoveringSourceSchemaMissing(error)) throw error;
			const rows = await query<ArticleRow>(
				`SELECT ${ARTICLE_COLUMNS_JOINED} FROM tanah_article a ORDER BY a.perek_id, a.priority`,
			);
			return rows.map((row) => ({ ...row, coverage_verified: false }));
		}
	},
);

// Get articles by perek
export const getArticlesByPerek = createServerFn({ method: "GET" })
	.validator((data: number) => data)
	.handler(async ({ data: perekId }) => {
		try {
			return await query<ArticleRow>(
				`SELECT ${ARTICLE_COVERAGE_COLUMNS_JOINED}, au.name as author_name, ${ARTICLE_COVERING_COUNT_SQL}
				 FROM tanah_article a
				 LEFT JOIN tanah_author au ON a.author_id = au.id
				 WHERE a.perek_id = ? ORDER BY a.priority`,
				[perekId],
			);
		} catch (error) {
			if (!isCoveringSourceSchemaMissing(error)) throw error;
			return await query<ArticleRow>(
				`SELECT ${ARTICLE_COLUMNS_JOINED}, au.name as author_name
				 FROM tanah_article a
				 LEFT JOIN tanah_author au ON a.author_id = au.id
				 WHERE a.perek_id = ? ORDER BY a.priority`,
				[perekId],
			);
		}
	});

// Get article by ID (with content)
export const getArticle = createServerFn({ method: "GET" })
	.validator((data: number) => data)
	.handler(async ({ data: id }) => {
		const article = await queryArticleRow(queryOne, id);

		if (!article) {
			throw new Error("Article not found");
		}

		return { ...article, coveringSources: await loadCoveringSources(id) };
	});

// Create article
export const createArticle = createServerFn({ method: "POST" })
	.validator((data: ArticleFormData) => data)
	.handler(async ({ data }) => {
		if (!data.name || !data.perek_id || !data.author_id) {
			throw new Error("Name, perek_id, and author_id are required");
		}
		// Client-side shape errors surface before any database write.
		const coveringRows =
			data.coveringSources === undefined
				? undefined
				: normalizeCoveringSources(data.coveringSources);

		await ensureArticleSearchQueue();
		const created = await transaction(async (conn) => {
			if (coveringRows !== undefined) {
				await assertCoveringSourcesExist(conn, coveringRows);
			}
			const result = await txExecute(
				conn,
				"INSERT INTO tanah_article (perek_id, author_id, abstract, name, priority, distributable, content) VALUES (?, ?, ?, ?, ?, ?, ?)",
				[
					data.perek_id,
					data.author_id,
					data.abstract || null,
					data.name,
					data.priority || 1,
					data.distributable === true,
					data.content || null,
				],
			);

			if (coveringRows !== undefined) {
				await replaceCoveringSources(
					conn,
					result.insertId,
					coveringRows,
					data.coverageVerified === true,
				);
			} else if (data.coverageVerified !== undefined) {
				await updateCoverageVerified(
					conn,
					result.insertId,
					data.coverageVerified,
				);
			}

			const newArticle = await queryArticleRow(
				(sql, params) => txQueryOne<ArticleRow>(conn, sql, params),
				result.insertId,
			);

			if (!newArticle) {
				throw new Error("Failed to retrieve created article");
			}
			// Same-transaction reading metrics (#2607): the stored decoration
			// commits atomically with the content it describes.
			await recomputeArticleMetrics(conn, newArticle.id, newArticle.content ?? null);
			// Same-transaction enqueue: the index update request commits atomically
			// with the article row.
			await txExecute(conn, ENQUEUE_SEARCH_SQL, [newArticle.id]);
			return {
				...newArticle,
				coveringSources: await txLoadCoveringSources(conn, newArticle.id),
			};
		});
		// Post-commit: expire the website's article caches so the new article
		// becomes public without a redeploy (see server/website-revalidate.ts).
		await revalidateWebsite(
			articleInvalidation(articlePath(created.perek_id, created.id)),
		);
		return created;
	});

// Update article
export const updateArticle = createServerFn({ method: "POST" })
	.validator((data: { id: number } & ArticleFormData) => data)
	.handler(async ({ data }) => {
		if (!data.name || !data.perek_id || !data.author_id) {
			throw new Error("Name, perek_id, and author_id are required");
		}
		const coveringRows =
			data.coveringSources === undefined
				? undefined
				: normalizeCoveringSources(data.coveringSources);

		await ensureArticleSearchQueue();
		let previousPerekId: number | null = null;
		const updatedArticle = await transaction(async (conn) => {
			if (coveringRows !== undefined) {
				await assertCoveringSourcesExist(conn, coveringRows);
			}
			// A perek move changes which chapter page lists the article — the
			// old chapter/article URL must be notified too.
			const prev = await txQueryOne<{ perek_id: number }>(
				conn,
				"SELECT perek_id FROM tanah_article WHERE id = ?",
				[data.id],
			);
			previousPerekId = prev?.perek_id ?? null;
			await txExecute(
				conn,
				"UPDATE tanah_article SET perek_id = ?, author_id = ?, abstract = ?, name = ?, priority = ?, distributable = ?, content = ? WHERE id = ?",
				[
					data.perek_id,
					data.author_id,
					data.abstract || null,
					data.name,
					data.priority || 1,
					data.distributable === true,
					data.content || null,
					data.id,
				],
			);

			if (coveringRows !== undefined) {
				await replaceCoveringSources(
					conn,
					data.id,
					coveringRows,
					data.coverageVerified === true,
				);
			} else if (data.coverageVerified !== undefined) {
				await updateCoverageVerified(conn, data.id, data.coverageVerified);
			}

			const updated = await queryArticleRow(
				(sql, params) => txQueryOne<ArticleRow>(conn, sql, params),
				data.id,
			);

			if (!updated) {
				throw new Error("Failed to retrieve updated article");
			}
			await recomputeArticleMetrics(conn, updated.id, updated.content ?? null);
			await txExecute(conn, ENQUEUE_SEARCH_SQL, [data.id]);
			return {
				...updated,
				coveringSources: await txLoadCoveringSources(conn, data.id),
			};
		});
		const urls = [articlePath(updatedArticle.perek_id, updatedArticle.id)];
		// A perek move leaves the old chapter URL stale — notify it too.
		if (
			previousPerekId !== null &&
			previousPerekId !== updatedArticle.perek_id
		) {
			urls.push(articlePath(previousPerekId, updatedArticle.id));
		}
		await revalidateWebsite(articleInvalidation(...urls));
		return updatedArticle;
	});

// Delete article
export const deleteArticle = createServerFn({ method: "POST" })
	.validator((data: number) => data)
	.handler(async ({ data }) => {
		await ensureArticleSearchQueue();
		// Resolve the public URL before the delete — afterwards the row (and
		// its perek) can no longer be enumerated.
		const deleted = await queryOne<{ perek_id: number }>(
			"SELECT perek_id FROM tanah_article WHERE id = ?",
			[data],
		);
		await transaction(async (conn) => {
			// Coverage rows are removed with the article — explicitly (the FK
			// ON DELETE CASCADE is the backstop) so cleanup does not depend on
			// constraint enforcement order. A pre-upgrade database has no
			// covering-source table and therefore nothing to clean.
			try {
				await txExecute(
					conn,
					"DELETE FROM tanah_article_covering_source WHERE article_id = ?",
					[data],
				);
			} catch (error) {
				if (!isCoveringSourceSchemaMissing(error)) throw error;
			}
			await txExecute(conn, "DELETE FROM tanah_article WHERE id = ?", [data]);
			// Enqueue the deleted id too: the worker observes the missing row and
			// purges it from the index — deleted articles must stop matching.
			await txExecute(conn, ENQUEUE_SEARCH_SQL, [data]);
		});
		// The article tag covers the deleted row's perek page and every other
		// article surface; the deleted URL is still notified so search engines
		// recrawl and drop it.
		await revalidateWebsite(
			articleInvalidation(
				...(deleted ? [articlePath(deleted.perek_id, data)] : []),
			),
		);
		return { success: true };
	});
