import { query } from "../api-client";
import { isMissingMysqlSchema } from "../mysql-errors";
import type { ScriptureRange } from "../reading/contract";
import { getArticleSummariesForRanges } from "../articles/service";
import type { ArticleSummary } from "../articles/types";
import { getAuthorImageUrl } from "../authors/service";
import {
	getArticleMetrics,
	metricOrFallback,
	type ReadingMetric,
} from "../reading-metrics";
import type { Moed, MoedSection, MoedSummary } from "./types";

/**
 * מועדים על הפרק reads (#3101): the published annual catalogue, the moed
 * detail (sections + ordered inclusive ranges) and the article union —
 * explicit article↔moed links merged with the shared range-match path.
 * The website ships independently of Data CD, so a database that reports
 * the moed schema missing degrades to an empty catalogue / a not-found
 * detail instead of failing the build — matching the covering-source
 * convention (isMissingMysqlSchema). A build/deploy that lands before the
 * seed must not pin that degraded result forever: the moed caches carry
 * {@link MOED_STALE_BOUND_SECONDS} so the route re-reads the database on
 * the next ISR window after the migration arrives, while editorial writes
 * still expire instantly through the moed tags.
 */

/**
 * Upper bound on how long a missing-schema catalogue/detail stays cached.
 * Data deploy seeds the moed tables without emitting a website
 * invalidation, so the degraded result gets this hourly TTL instead of
 * the usual tag-only eternity. A positive `revalidate` on `unstable_cache`
 * propagates to the consuming route's `initialRevalidateSeconds` — the
 * moadim routes are hourly ISR.
 */
export const MOED_STALE_BOUND_SECONDS = 3600;

interface MoedRow {
	id: number;
	slug: string;
	name: string;
	summary: string | null;
	hebrew_month: string | null;
	date_label: string | null;
	annual_order: number;
}

const MOED_COLUMNS =
	"id, slug, name, summary, hebrew_month, date_label, annual_order";

function toSummary(row: MoedRow): MoedSummary {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		summary: row.summary,
		hebrewMonth: row.hebrew_month,
		dateLabel: row.date_label,
		annualOrder: row.annual_order,
	};
}

/** The published catalogue in annual order — the wheel's data source. */
export async function getPublishedMoadim(): Promise<MoedSummary[]> {
	try {
		const rows = await query<MoedRow>(
			`SELECT ${MOED_COLUMNS} FROM tanah_moed
			 WHERE published = TRUE ORDER BY annual_order`,
		);
		return rows.map(toSummary);
	} catch (error) {
		// Moed schema not deployed yet: the public section stays reachable
		// and honest about having no catalogue rather than failing builds.
		if (isMissingMysqlSchema(error)) {
			console.warn(
				"Moed schema is not deployed yet; serving an empty מועדים catalogue until the migration runs.",
			);
			return [];
		}
		throw error;
	}
}

/** Every published moed slug — sitemap and generateStaticParams feed. */
export async function getPublishedMoedSlugs(): Promise<string[]> {
	return (await getPublishedMoadim()).map((moed) => moed.slug);
}

interface MoedSectionRow {
	id: number;
	label: string;
	position: number;
}

interface MoedRangeRow {
	section_id: number;
	position: number;
	perek_id_start: number;
	pasuk_start: number;
	perek_id_end: number;
	pasuk_end: number;
}

/**
 * One published moed by its canonical slug with ordered sections and
 * ranges. `null` when the moed is missing, unpublished, or the moed
 * schema is not deployed — the route maps it to a plain not-found.
 */
export async function getMoedBySlug(slug: string): Promise<Moed | null> {
	try {
		const row = (
			await query<MoedRow>(
				`SELECT ${MOED_COLUMNS} FROM tanah_moed
				 WHERE slug = ? AND published = TRUE`,
				[slug],
			)
		)[0];
		if (!row) return null;
		const sections = await query<MoedSectionRow>(
			`SELECT id, label, position FROM tanah_moed_section
			 WHERE moed_id = ? ORDER BY position`,
			[row.id],
		);
		const ranges =
			sections.length === 0
				? []
				: await query<MoedRangeRow>(
						`SELECT r.section_id, r.position, r.perek_id_start, r.pasuk_start,
						        r.perek_id_end, r.pasuk_end
						 FROM tanah_moed_range r
						 JOIN tanah_moed_section s ON s.id = r.section_id
						 WHERE s.moed_id = ? ORDER BY s.position, r.position`,
						[row.id],
					);
		const bySection = new Map<number, ScriptureRange[]>();
		for (const range of ranges) {
			const list = bySection.get(range.section_id) ?? [];
			list.push({
				start: {
					perekId: range.perek_id_start,
					pasuk: range.pasuk_start,
				},
				end: {
					perekId: range.perek_id_end,
					pasuk: range.pasuk_end,
				},
			});
			bySection.set(range.section_id, list);
		}
		const mapped: MoedSection[] = sections.map((section) => ({
			id: section.id,
			label: section.label,
			ranges: bySection.get(section.id) ?? [],
		}));
		return {
			...toSummary(row),
			sections: mapped,
			ranges: mapped.flatMap((section) => section.ranges),
		};
	} catch (error) {
		if (isMissingMysqlSchema(error)) {
			console.warn(
				`Moed schema is not deployed yet; /מועדים/${slug} answers not-found until the migration runs.`,
			);
			return null;
		}
		throw error;
	}
}

/**
 * The moed's article set: the union of the shared range-match path
 * (verified covering rows, primary-perek fallback — the same semantics
 * every reading surface uses) and the explicit article↔moed links.
 * Range matches keep their deterministic reading order; explicit-only
 * articles append ordered by priority then id, and every article lists
 * once no matter how many sources matched.
 */
export async function getMoedArticleSummaries(
	moedId: number,
	ranges: ScriptureRange[],
): Promise<ArticleSummary[]> {
	const [rangeMatches, linkedRows] = await Promise.all([
		getArticleSummariesForRanges(ranges),
		query<{
			id: number;
			perek_id: number;
			author_id: number;
			abstract: string | null;
			name: string;
			priority: number;
			author_name: string;
		}>(
			`SELECT a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority,
			        au.name AS author_name
			 FROM tanah_article_moed am
			 JOIN tanah_article a ON a.id = am.article_id
			 JOIN tanah_author au ON a.author_id = au.id
			 WHERE am.moed_id = ? AND a.perek_id BETWEEN 1 AND 929
			 ORDER BY a.priority ASC, a.id ASC`,
			[moedId],
		),
	]);
	const seen = new Set(rangeMatches.map((article) => article.id));
	const explicitOnly: ArticleSummary[] = linkedRows
		.filter((row) => !seen.has(row.id))
		.map((row) => ({
			id: row.id,
			perekId: row.perek_id,
			authorId: row.author_id,
			abstract: row.abstract,
			name: row.name,
			priority: row.priority,
			authorName: row.author_name,
			authorImageUrl: getAuthorImageUrl(row.author_id),
		}));
	// Metrics decoration for the explicit-only tail — range matches arrive
	// decorated already.
	const metrics = await metricOrFallback(
		`moed articles (moed ${moedId})`,
		new Map<number, ReadingMetric>(),
		() => getArticleMetrics(explicitOnly.map((a) => a.id)),
	);
	const decorated = explicitOnly.map((article) => {
		const metric = metrics.get(article.id);
		return metric ? { ...article, metric } : article;
	});
	return [...rangeMatches, ...decorated];
}
