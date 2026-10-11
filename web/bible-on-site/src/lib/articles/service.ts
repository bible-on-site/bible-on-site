import { query } from "../api-client";
import { getAuthorImageUrl } from "../authors/service";
import type { Article, ArticleSummary } from "./types";

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

interface ArticleSummaryRow {
	id: number;
	perek_id: number;
	author_id: number;
	abstract: string | null;
	name: string;
	priority: number;
	author_name: string;
}

/**
 * Fetch articles for a specific perek with author information.
 * JOINs with tanah_author to get author name.
 * Returns an empty array when no articles are found; rejects database failures.
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
			 WHERE a.perek_id = ? AND a.perek_id BETWEEN 1 AND 929
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
		console.warn(
			`Failed to fetch articles for perek ${perekId}:`,
			error instanceof Error ? error.message : error,
		);
		throw error;
	}
}

/**
 * Fetch article summaries for a specific perek (no full content).
 * Used for carousel display and book view where only metadata is needed.
 */
export async function getArticleSummariesByPerekId(
	perekId: number,
): Promise<ArticleSummary[]> {
	try {
		const rows = await query<ArticleSummaryRow>(
			`SELECT
				a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority,
				au.name AS author_name
			 FROM tanah_article a
			 JOIN tanah_author au ON a.author_id = au.id
			 WHERE a.perek_id = ? AND a.perek_id BETWEEN 1 AND 929
			 ORDER BY a.priority ASC`,
			[perekId],
		);

		return rows.map((row) => ({
			id: row.id,
			perekId: row.perek_id,
			authorId: row.author_id,
			abstract: row.abstract,
			name: row.name,
			priority: row.priority,
			authorName: row.author_name,
			authorImageUrl: getAuthorImageUrl(row.author_id),
		}));
	} catch (error) {
		console.warn(
			"Failed to fetch article summaries for perek %d:",
			perekId,
			error instanceof Error ? error.message : error,
		);
		// Reject so a failed build/request cannot cache an empty article list.
		throw error;
	}
}

export interface ArticlePerekPair {
	articleId: number;
	perekId: number;
}

/**
 * Fetch all article ID and perek ID pairs.
 * Used for sitemap generation to enumerate all article URLs.
 * Rejects database failures so static generation cannot publish missing URLs.
 */
export async function getAllArticlePerekIdPairs(): Promise<ArticlePerekPair[]> {
	try {
		const rows = await query<{ id: number; perek_id: number }>(
			`SELECT id, perek_id FROM tanah_article WHERE perek_id BETWEEN 1 AND 929 ORDER BY perek_id ASC, id ASC`,
		);
		return rows.map((row) => ({
			articleId: row.id,
			perekId: row.perek_id,
		}));
	} catch (error) {
		console.warn(
			"Failed to fetch article-perek pairs:",
			error instanceof Error ? error.message : error,
		);
		throw error;
	}
}

/**
 * Fetch all article IDs grouped by perek ID.
 * Used by generateStaticParams for bulk fetching in a single query.
 */
/* istanbul ignore next -- bulk query kept for future SSG use */
export async function getAllArticleIdsByPerek(): Promise<
	Map<number, number[]>
> {
	try {
		const rows = await query<{ id: number; perek_id: number }>(
			`SELECT id, perek_id FROM tanah_article WHERE perek_id BETWEEN 1 AND 929 ORDER BY perek_id ASC, id ASC`,
		);
		const map = new Map<number, number[]>();
		for (const row of rows) {
			const list = map.get(row.perek_id);
			if (list) {
				list.push(row.id);
			} else {
				map.set(row.perek_id, [row.id]);
			}
		}
		return map;
	} catch (error) {
		console.warn(
			"Failed to fetch all article IDs by perek:",
			error instanceof Error ? error.message : error,
		);
		throw error;
	}
}

/**
 * Fetch a single article by ID with author information.
 * Returns null if not found; rejects database failures to avoid caching false 404s.
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
			 WHERE a.id = ? AND a.perek_id BETWEEN 1 AND 929`,
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
		throw error;
	}
}
