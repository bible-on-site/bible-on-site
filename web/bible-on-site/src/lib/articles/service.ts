import { query } from "../api-client";
import { isMissingMysqlSchema } from "../mysql-errors";
import { getAuthorImageUrl } from "../authors/service";
import type { ScriptureRange } from "../reading/contract";
import {
	coveringSourceSliceCondition,
	coveringSourceSliceRank,
	groupedSliceSelects,
	primaryPerekSliceRank,
	slicePerekIds,
	slicesForRanges,
} from "../reading/queries";
import { getArticleMetrics, metricOrFallback } from "../reading-metrics";
import type { ReadingMetric } from "../reading-metrics";
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

function toArticleSummary(row: ArticleSummaryRow): ArticleSummary {
	return {
		id: row.id,
		perekId: row.perek_id,
		authorId: row.author_id,
		abstract: row.abstract,
		name: row.name,
		priority: row.priority,
		authorName: row.author_name,
		authorImageUrl: getAuthorImageUrl(row.author_id),
	};
}

/**
 * Attach stored reading metrics (#2607). `metric` is set only when a metric
 * row exists — unknown (no row / schema not deployed) stays absent, distinct
 * from a verified-empty metric's zeros. The read is optional decoration: a
 * failed metric query must not hide the loaded articles.
 */
async function withArticleMetrics<T extends { id: number }>(
	items: T[],
): Promise<(T & { metric?: ReadingMetric })[]> {
	const metrics = await metricOrFallback(
		`articles (${items.length} ids)`,
		new Map<number, ReadingMetric>(),
		() => getArticleMetrics(items.map((i) => i.id)),
	);
	return items.map((item) => {
		const metric = metrics.get(item.id);
		return metric ? { ...item, metric } : item;
	});
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

		return withArticleMetrics(
			rows.map((row) => ({
				id: row.id,
				perekId: row.perek_id,
				authorId: row.author_id,
				abstract: row.abstract,
				content: row.content,
				name: row.name,
				priority: row.priority,
				authorName: row.author_name,
				authorImageUrl: getAuthorImageUrl(row.author_id),
			})),
		);
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

		return withArticleMetrics(rows.map(toArticleSummary));
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
 * Batch variant of {@link getArticleSummariesByPerekId}: one grouped
 * query for a whole set of perakim (e.g. every perek of a sefer's book
 * view) instead of one query per perek, followed by a single metrics
 * read over all returned articles. Keys are perek ids; a perek with no
 * articles simply has no key.
 */
export async function getArticleSummariesByPerekIds(
	perekIds: number[],
): Promise<Map<number, ArticleSummary[]>> {
	const byPerek = new Map<number, ArticleSummary[]>();
	if (perekIds.length === 0) return byPerek;
	const placeholders = perekIds.map(() => "?").join(", ");
	try {
		const rows = await query<ArticleSummaryRow>(
			`SELECT
				a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority,
				au.name AS author_name
			 FROM tanah_article a
			 JOIN tanah_author au ON a.author_id = au.id
			 WHERE a.perek_id IN (${placeholders}) AND a.perek_id BETWEEN 1 AND 929
			 ORDER BY a.perek_id ASC, a.priority ASC`,
			perekIds,
		);

		for (const summary of await withArticleMetrics(
			rows.map(toArticleSummary),
		)) {
			const list = byPerek.get(summary.perekId) ?? [];
			list.push(summary);
			byPerek.set(summary.perekId, list);
		}
		return byPerek;
	} catch (error) {
		console.warn(
			"Failed to fetch article summaries for %d perakim:",
			perekIds.length,
			error instanceof Error ? error.message : error,
		);
		// Reject so a failed build/request cannot cache an empty article list.
		throw error;
	}
}

/**
 * Whether a query rejection means the covering-source schema (#2189)
 * is not deployed yet — the missing `coverage_verified` column or the
 * missing `tanah_article_covering_source` table. Anything else is a
 * real failure.
 */
const isCoveringSourceSchemaMissing = isMissingMysqlSchema;

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
 * Results keep reading order: each article ranks by the ordinal of its
 * FIRST matching slice in supplied range order (covering-row slices for
 * verified articles, primary-perek slices for unverified ones), then by
 * priority — so an article reached through a later Haftarah jump never
 * precedes one from the opening range just because its priority is
 * lower.
 *
 * The website ships independently of Data CD, and packaging prerenders
 * Masora pages against production RDS: between merge and the schema
 * upgrade the new column/table do not exist yet. When the database
 * reports the covering-source schema missing, the reader degrades to
 * the pre-upgrade query — every article matched through its primary
 * perek, ranked the same way — instead of failing the build; any other
 * failure still rejects so a failed build/request cannot cache an
 * empty article list.
 *
 * All public articles are eligible: `distributable` gates only the daily
 * bulletin email, never the site.
 */
export async function getArticleSummariesForRanges(
	ranges: ScriptureRange[],
): Promise<ArticleSummary[]> {
	const slices = slicesForRanges(ranges);
	if (slices.length === 0) return [];
	const perekIds = slicePerekIds(slices);
	const placeholders = perekIds.map(() => "?").join(", ");
	const covering = coveringSourceSliceCondition(slices);
	const coveringRank = coveringSourceSliceRank(slices);
	const perekRank = primaryPerekSliceRank(slices);
	const selectSummary = `SELECT
			a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority,
			au.name AS author_name
		 FROM tanah_article a
		 JOIN tanah_author au ON a.author_id = au.id`;
	const coveringSourceSql = `${selectSummary}
		 WHERE (a.coverage_verified = FALSE
				AND a.perek_id BETWEEN 1 AND 929
				AND a.perek_id IN (${placeholders}))
			OR (a.coverage_verified = TRUE
				AND EXISTS (
					SELECT 1 FROM tanah_article_covering_source cs
					WHERE cs.article_id = a.id AND (${covering.sql})))
		 ORDER BY ${coveringRank.sql} ASC, a.priority ASC`;
	// Pre-upgrade schema: coverage_verified and the covering-source
	// table do not exist yet, so every article matches through its
	// primary perek alone — the same match granularity the unverified
	// branch above keeps after the migration.
	const primaryPerekSql = `${selectSummary}
		 WHERE a.perek_id BETWEEN 1 AND 929
			AND a.perek_id IN (${placeholders})
		 ORDER BY ${perekRank.sql} ASC, a.priority ASC`;
	try {
		const rows = await query<ArticleSummaryRow>(coveringSourceSql, [
			...perekIds,
			...covering.params,
			...coveringRank.params,
		]).catch((error: unknown) => {
			if (!isCoveringSourceSchemaMissing(error)) throw error;
			console.warn(
				"Article covering-source schema is not deployed yet; " +
					"matching articles by primary perek until the migration runs.",
			);
			return query<ArticleSummaryRow>(primaryPerekSql, [
				...perekIds,
				...perekRank.params,
			]);
		});

		return withArticleMetrics(rows.map(toArticleSummary));
	} catch (error) {
		console.warn(
			"Failed to fetch article summaries for ranges:",
			error instanceof Error ? error.message : error,
		);
		// Reject so a failed build/request cannot cache an empty article list.
		throw error;
	}
}

interface GroupedArticleSummaryRow extends ArticleSummaryRow {
	unit_order: number;
}

/**
 * Batch variant of {@link getArticleSummariesForRanges}: one grouped
 * query for several range lists (e.g. every unit of an
 * alternative-division sefer book, issue #2191) instead of one query
 * per unit, followed by a single metrics read over all returned
 * articles. Element i of the result holds the summaries for
 * `rangeGroups[i]` under the same coverage and ordering semantics — an
 * article overlapping the ranges of two units appears in both.
 */
export async function getArticleSummariesForRangeGroups(
	rangeGroups: ScriptureRange[][],
): Promise<ArticleSummary[][]> {
	const sliceGroups = rangeGroups.map(slicesForRanges);
	const byUnit: ArticleSummary[][] = rangeGroups.map(() => []);
	if (sliceGroups.every((slices) => slices.length === 0)) return byUnit;
	const slicesTable = groupedSliceSelects(sliceGroups);
	const groupOrder = `GROUP BY sm.unit_order, a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority, au.name
		 ORDER BY sm.unit_order ASC, first_slice_order ASC, a.priority ASC`;
	const selectSummary = `SELECT
			sm.unit_order AS unit_order,
			MIN(sm.slice_order) AS first_slice_order,
			a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority,
			au.name AS author_name
		 FROM tanah_article a
		 JOIN tanah_author au ON a.author_id = au.id
		 JOIN (${slicesTable.sql}) sm`;
	const coveringSourceSql = `${selectSummary}
			ON (a.coverage_verified = TRUE AND EXISTS (
				SELECT 1 FROM tanah_article_covering_source cs
				WHERE cs.article_id = a.id
					AND cs.perek_id = sm.perek_id
					AND cs.pasuk BETWEEN sm.start_pasuk AND sm.end_pasuk))
			OR (a.coverage_verified = FALSE
				AND a.perek_id BETWEEN 1 AND 929
				AND a.perek_id = sm.perek_id)
		 ${groupOrder}`;
	// Pre-upgrade-schema fallback mirroring getArticleSummariesForRanges:
	// match every article through its primary perek alone.
	const primaryPerekSql = `${selectSummary}
			ON a.perek_id = sm.perek_id
		 WHERE a.perek_id BETWEEN 1 AND 929
		 ${groupOrder}`;
	try {
		const rows = await query<GroupedArticleSummaryRow>(
			coveringSourceSql,
			slicesTable.params,
		).catch((error: unknown) => {
			if (!isCoveringSourceSchemaMissing(error)) throw error;
			console.warn(
				"Article covering-source schema is not deployed yet; " +
					"matching articles by primary perek until the migration runs.",
			);
			return query<GroupedArticleSummaryRow>(
				primaryPerekSql,
				slicesTable.params,
			);
		});

		const decorated = await withArticleMetrics(
			rows.map((row) => ({ ...toArticleSummary(row), unit: row.unit_order })),
		);
		for (const item of decorated) {
			const { unit, ...summary } = item;
			byUnit[unit]?.push(summary);
		}
		return byUnit;
	} catch (error) {
		console.warn(
			"Failed to fetch article summaries for range groups:",
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
		const [enriched] = await withArticleMetrics([
			{
				id: row.id,
				perekId: row.perek_id,
				authorId: row.author_id,
				abstract: row.abstract,
				content: row.content,
				name: row.name,
				priority: row.priority,
				authorName: row.author_name,
				authorImageUrl: getAuthorImageUrl(row.author_id),
			},
		]);
		return enriched;
	} catch (error) {
		console.warn(
			"Failed to fetch article %s:",
			articleId,
			error instanceof Error ? error.message : error,
		);
		throw error;
	}
}

/**
 * The article assigned to one recurring Hebrew month/day (#3098), or null
 * when the date has no assignment and ordinary per-perek selection applies.
 * `hebrewMonth` uses the uniform numbering shared with the app, the API and
 * the bulletin (1=Tishrei..12=Elul, 6=Adar of a non-leap year, 13=Adar I,
 * 14=Adar II in leap years). The assignment is a complete override — the
 * returned summary is the day's sole article, never an extra candidate.
 * Before the migration is deployed the table is absent and the lookup
 * rejects rather than resolving null: the caller caches loader results
 * without expiry (`revalidate: false`), so a cached null would keep hiding
 * the assignment after the migration lands — a thrown loader error is never
 * cached, and the client hook degrades the rejection to the ordinary list.
 */
export async function getArticleHebrewDateOverride(
	hebrewMonth: number,
	hebrewDay: number,
): Promise<ArticleSummary | null> {
	try {
		const rows = await query<ArticleSummaryRow>(
			`SELECT
				a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority,
				au.name AS author_name
			 FROM tanah_article_hebrew_date hd
			 JOIN tanah_article a ON a.id = hd.article_id
			 JOIN tanah_author au ON a.author_id = au.id
			 WHERE hd.hebrew_month = ? AND hd.hebrew_day = ?
			 LIMIT 1`,
			[hebrewMonth, hebrewDay],
		);

		if (rows.length === 0) {
			return null;
		}
		const [enriched] = await withArticleMetrics([toArticleSummary(rows[0])]);
		return enriched;
	} catch (error) {
		if (isMissingMysqlSchema(error)) {
			console.warn(
				"Article Hebrew-date override schema is not deployed yet; " +
					"dates keep ordinary article lists until the migration runs.",
			);
		} else {
			console.warn(
				"Failed to fetch Hebrew-date article override %d-%d:",
				hebrewMonth,
				hebrewDay,
				error instanceof Error ? error.message : error,
			);
		}
		// Never resolve a missing schema to null — see the doc comment: a
		// thrown loader error is never cached, so the rollout window retries
		// until the table exists instead of pinning a false "no assignment".
		throw error;
	}
}
