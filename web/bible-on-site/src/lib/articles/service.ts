import { query } from "../api-client";
import { getAuthorImageUrl } from "../authors/service";
import type { ScriptureRange } from "../reading/contract";
import {
	coveringSourceSliceCondition,
	slicePerekIds,
	slicesForRanges,
} from "../reading/queries";
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

/**
 * Fetch article summaries whose scripture coverage overlaps the given
 * canonical ranges — the shared unit->article path for the reading
 * divisions (מסורה units, פרשה ranges, ordered multi-range Haftarah
 * lookups).
 *
 * Coverage semantics (tanah_article_covering_source, #2189):
 * - `coverage_verified = TRUE`: the covering rows are the article's
 *   verified coverage — the article matches when any row lands inside a
 *   slice (pasuk granularity). EXISTS yields one row per article no
 *   matter how many covering rows match, so multi-match articles are
 *   deduplicated.
 * - `coverage_verified = FALSE` (every article whose coverage was never
 *   mapped): coverage is unknown, so the article falls back to its
 *   primary perek association — honest perek-level matching that does
 *   not claim pasuk precision.
 *
 * All public articles are eligible: `distributable` gates only the daily
 * bulletin email, never the site. Like the per-perek path, database
 * failures reject rather than caching an empty article list.
 */
export async function getArticleSummariesForRanges(
	ranges: ScriptureRange[],
): Promise<ArticleSummary[]> {
	const slices = slicesForRanges(ranges);
	if (slices.length === 0) return [];
	const perekIds = slicePerekIds(slices);
	const placeholders = perekIds.map(() => "?").join(", ");
	const covering = coveringSourceSliceCondition(slices);
	try {
		const rows = await query<ArticleSummaryRow>(
			`SELECT
				a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority,
				au.name AS author_name
			 FROM tanah_article a
			 JOIN tanah_author au ON a.author_id = au.id
			 WHERE (a.coverage_verified = FALSE
					AND a.perek_id BETWEEN 1 AND 929
					AND a.perek_id IN (${placeholders}))
				OR (a.coverage_verified = TRUE
					AND EXISTS (
						SELECT 1 FROM tanah_article_covering_source cs
						WHERE cs.article_id = a.id AND (${covering.sql})))
			 ORDER BY a.priority ASC`,
			[...perekIds, ...covering.params],
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
			"Failed to fetch article summaries for ranges:",
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
