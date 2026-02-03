import { query } from "../api-client";
import { getAuthorImageUrl } from "../authors/service";
import type { Article } from "./types";

interface ArticleWithAuthorRow {
	id: number;
	perek_id: number;
	author_id: number;
	abstract: string | null;
	content: string | null;
	name: string;
	priority: number;
	author_name: string;
}

/**
 * Fetch articles for a specific perek with author information.
 * JOINs with tanah_author to get author name.
 * Returns empty array if database is unavailable or no articles found.
 */
export async function getArticlesByPerekId(
	perekId: number,
): Promise<Article[]> {
	try {
		const rows = await query<ArticleWithAuthorRow>(
			`SELECT
				a.id, a.perek_id, a.author_id, a.abstract, a.content, a.name, a.priority,
				au.name AS author_name
			 FROM tanah_article a
			 JOIN tanah_author au ON a.author_id = au.id
			 WHERE a.perek_id = ?
			 ORDER BY a.priority ASC`,
			[perekId],
		);

		return rows.map((row) => ({
			id: row.id,
			perekId: row.perek_id,
			authorId: row.author_id,
			abstract: row.abstract,
			content: row.content,
			name: row.name,
			priority: row.priority,
			authorName: row.author_name,
			authorImageUrl: getAuthorImageUrl(row.author_id),
		}));
	} catch (error) {
		// During SSG build, database may not be available
		// Return empty array gracefully
		console.warn(
			`Failed to fetch articles for perek ${perekId}:`,
			error instanceof Error ? error.message : error,
		);
		return [];
	}
}

/**
 * Fetch a single article by ID with author information.
 * Returns null if not found or database unavailable.
 */
export async function getArticleById(
	articleId: number,
): Promise<Article | null> {
	try {
		const rows = await query<ArticleWithAuthorRow>(
			`SELECT
				a.id, a.perek_id, a.author_id, a.abstract, a.content, a.name, a.priority,
				au.name AS author_name
			 FROM tanah_article a
			 JOIN tanah_author au ON a.author_id = au.id
			 WHERE a.id = ?`,
			[articleId],
		);

		if (rows.length === 0) {
			return null;
		}

		const row = rows[0];
		return {
			id: row.id,
			perekId: row.perek_id,
			authorId: row.author_id,
			abstract: row.abstract,
			content: row.content,
			name: row.name,
			priority: row.priority,
			authorName: row.author_name,
			authorImageUrl: getAuthorImageUrl(row.author_id),
		};
	} catch (error) {
		console.warn(
			`Failed to fetch article ${articleId}:`,
			error instanceof Error ? error.message : error,
		);
		return null;
	}
}
