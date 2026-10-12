import { createServerFn } from "@tanstack/react-start";
import {
	execute,
	query,
	queryOne,
	transaction,
	txExecute,
	txQueryOne,
} from "./db";

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
}

// Get all articles (without content for performance)
export const getArticles = createServerFn({ method: "GET" }).handler(
	async () => {
		return await query<Omit<Article, "content">>(
			"SELECT id, perek_id, author_id, abstract, name, priority, distributable FROM tanah_article ORDER BY perek_id, priority",
		);
	},
);

// Get articles by perek
export const getArticlesByPerek = createServerFn({ method: "GET" })
	.validator((data: number) => data)
	.handler(async ({ data: perekId }) => {
		const articles = await query<
			Omit<Article, "content"> & { author_name?: string }
		>(
			`SELECT a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority, a.distributable, au.name as author_name
			 FROM tanah_article a
			 LEFT JOIN tanah_author au ON a.author_id = au.id
			 WHERE a.perek_id = ? ORDER BY a.priority`,
			[perekId],
		);
		return articles;
	});

// Get article by ID (with content)
export const getArticle = createServerFn({ method: "GET" })
	.validator((data: number) => data)
	.handler(async ({ data: id }) => {
		const article = await queryOne<Article>(
			"SELECT id, perek_id, author_id, abstract, name, priority, distributable, content FROM tanah_article WHERE id = ?",
			[id],
		);

		if (!article) {
			throw new Error("Article not found");
		}

		return article;
	});

// Create article
export const createArticle = createServerFn({ method: "POST" })
	.validator((data: ArticleFormData) => data)
	.handler(async ({ data }) => {
		if (!data.name || !data.perek_id || !data.author_id) {
			throw new Error("Name, perek_id, and author_id are required");
		}

		await ensureArticleSearchQueue();
		return await transaction(async (conn) => {
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

			const newArticle = await txQueryOne<Article>(
				conn,
				"SELECT id, perek_id, author_id, abstract, name, priority, distributable, content FROM tanah_article WHERE id = ?",
				[result.insertId],
			);

			if (!newArticle) {
				throw new Error("Failed to retrieve created article");
			}
			// Same-transaction enqueue: the index update request commits atomically
			// with the article row.
			await txExecute(conn, ENQUEUE_SEARCH_SQL, [newArticle.id]);
			return newArticle;
		});
	});

// Update article
export const updateArticle = createServerFn({ method: "POST" })
	.validator((data: { id: number } & ArticleFormData) => data)
	.handler(async ({ data }) => {
		if (!data.name || !data.perek_id || !data.author_id) {
			throw new Error("Name, perek_id, and author_id are required");
		}

		await ensureArticleSearchQueue();
		return await transaction(async (conn) => {
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

			const updated = await txQueryOne<Article>(
				conn,
				"SELECT id, perek_id, author_id, abstract, name, priority, distributable, content FROM tanah_article WHERE id = ?",
				[data.id],
			);

			if (!updated) {
				throw new Error("Failed to retrieve updated article");
			}
			await txExecute(conn, ENQUEUE_SEARCH_SQL, [data.id]);
			return updated;
		});
	});

// Delete article
export const deleteArticle = createServerFn({ method: "POST" })
	.validator((data: number) => data)
	.handler(async ({ data }) => {
		await ensureArticleSearchQueue();
		await transaction(async (conn) => {
			await txExecute(conn, "DELETE FROM tanah_article WHERE id = ?", [data]);
			// Enqueue the deleted id too: the worker observes the missing row and
			// purges it from the index — deleted articles must stop matching.
			await txExecute(conn, ENQUEUE_SEARCH_SQL, [data]);
		});
		return { success: true };
	});

// Cache invalidation - call CloudFront or your caching layer
export const invalidateArticleCache = createServerFn({ method: "POST" })
	.validator((data: number) => data)
	.handler(async ({ data: articleId }) => {
		// TODO: Implement CloudFront invalidation when ready
		console.log(`Invalidating cache for article ${articleId}`);
		return { success: true };
	});

export const invalidatePerekCache = createServerFn({ method: "POST" })
	.validator((data: number) => data)
	.handler(async ({ data: perekId }) => {
		// TODO: Implement CloudFront invalidation when ready
		console.log(`Invalidating cache for perek ${perekId}`);
		return { success: true };
	});
