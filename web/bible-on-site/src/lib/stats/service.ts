import { query } from "../api-client";

/**
 * Live totals for the homepage "מספרים על הפרק" counters (#2397).
 *
 * Counting rules follow the site's public-visibility conventions:
 * - rabbis: distinct authors having at least one public article
 *   (same predicate as the authors listing: primary perek in 1-929).
 * - articles: public articles — every row whose primary perek is in
 *   1-929 (per-article covering sources and aliases never inflate it).
 * - pediaEntries: public Tanahpedia entries.
 *
 * The queries run per render and are intentionally NOT wrapped in
 * unstable_cache: the homepage is refreshed on demand through
 * POST /api/revalidate?path=/, and a cached result would survive that
 * revalidation and keep serving stale totals.
 */
export interface PerekStats {
	rabbis: number;
	articles: number;
	pediaEntries: number;
}

/**
 * Fetch the three totals with aggregate queries (no row loading).
 * Rejects on failure — a data failure must not surface as a zero count.
 */
export async function getPerekStats(): Promise<PerekStats> {
	try {
		const [rabbis, articles, pediaEntries] = await Promise.all([
			query<{ c: number }>(
				"SELECT COUNT(DISTINCT author_id) AS c FROM tanah_article WHERE perek_id BETWEEN 1 AND 929",
			),
			query<{ c: number }>(
				"SELECT COUNT(*) AS c FROM tanah_article WHERE perek_id BETWEEN 1 AND 929",
			),
			query<{ c: number }>("SELECT COUNT(*) AS c FROM tanahpedia_entry"),
		]);
		return {
			rabbis: Number(rabbis[0]?.c ?? 0),
			articles: Number(articles[0]?.c ?? 0),
			pediaEntries: Number(pediaEntries[0]?.c ?? 0),
		};
	} catch (error) {
		console.warn(
			"Failed to fetch perek stats:",
			error instanceof Error ? error.message : error,
		);
		throw error;
	}
}
