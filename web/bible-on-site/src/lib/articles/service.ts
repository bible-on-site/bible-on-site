import { query } from "../api-client";
import type { Article } from "./types";

interface ArticleRow {
	id: number;
	perek_id: number;
	author_id: number;
	abstract: string | null;
	name: string;
	priority: number;
}

/**
 * Fetch articles for a specific perek directly from database
 * Returns empty array if database is unavailable or no articles found
 */
export async function getArticlesByPerekId(perekId: number): Promise<Article[]> {
	try {
		const rows = await query<ArticleRow>(
			`SELECT id, perek_id, author_id, abstract, name, priority
			 FROM tanah_article
			 WHERE perek_id = ?
			 ORDER BY priority ASC`,
			[perekId],
		);

		return rows.map((row) => ({
			id: row.id,
			perekId: row.perek_id,
			authorId: row.author_id,
			abstract: row.abstract,
			name: row.name,
			priority: row.priority,
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
