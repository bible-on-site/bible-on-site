import { countRecordedPerakim } from "@/data/perek-dto";
import { getProgrammeYearsElapsed } from "@/data/learning-schedule";
import { getCurrentDate } from "@/util/date";
import { constructTsetAwareHDate } from "@/util/hebdates-util";
import { query } from "../api-client";

/**
 * Live totals for the homepage "מספרים על הפרק" counters (#2397).
 *
 * Counting rules follow the site's public-visibility conventions:
 * - articles: public articles — every row whose primary perek is in
 *   1-929 (per-article covering sources and aliases never inflate it).
 * - pediaEntries: public Tanahpedia entries with a meaningful entry body —
 *   the same `content` the entry page renders, required to hold visible
 *   text once markup, HTML entities and whitespace are stripped. Rows kept
 *   only to hang family-tree data (null, empty, or markup-only content
 *   like `<p></p>`) are not entries on the perek and are excluded.
 * - recordedPerakim: distinct canonical perakim with a published recording
 *   — the `recitation` record in the canonical perakim DB, which only
 *   exists once an audio asset is actually published. Alignment approval
 *   (`alignmentStatus`) is unrelated to availability and never filters a
 *   playable recording out.
 * - illustrations: distinct logical perek illustrations the public reader
 *   can actually display — `is_active` images with at least one usable
 *   display WebP variant, the same eligibility `imagesFromRows` applies.
 *   AVIF/JPEG encodings, sizes, social crops and joined verse-range rows
 *   never multiply the count.
 * - programmeYears: completed Hebrew years since the first study day of
 *   the first cycle (29 Kislev 5775, from the canonical cycle data), using
 *   the same Jerusalem-date + tzeit "today" the study schedule uses.
 * - rabbis: deliberately NOT counted — a halakhic objection to counting
 *   rabbis means the counter shows the fixed word עשרות instead, so no
 *   exact-author-count aggregation belongs in this feature.
 *
 * The homepage is prerendered, so these are computed when the route
 * regenerates; the year counter turns over on the first regeneration after
 * its anniversary. POST /api/revalidate remains an independently
 * functioning refresh path. The queries run per render and are
 * intentionally NOT wrapped in unstable_cache for the same reason.
 */
export interface PerekStats {
	articles: number;
	pediaEntries: number;
	illustrations: number;
	recordedPerakim: number;
	programmeYears: number;
}

/**
 * Counts only entries whose rendered body carries visible text: strip tags,
 * decode the whitespace entities authors produce (`&nbsp;`, `&#160;`), drop
 * literal non-breaking spaces, then require a non-whitespace remainder.
 */
const MEANINGFUL_PEDIA_ENTRIES_SQL = `
	SELECT COUNT(*) AS c FROM tanahpedia_entry
	WHERE CHAR_LENGTH(REGEXP_REPLACE(
		REPLACE(REPLACE(REPLACE(
			REGEXP_REPLACE(content, '<[^>]+>', ''),
			'&nbsp;', ' '),
			'&#160;', ' '),
			CHAR(0xC2A0 USING utf8mb4), ''),
		'\\\\s', '')) > 0
`;

/**
 * One row per distinct logical illustration the reader could display:
 * an active image carrying a usable display WebP variant — the exact
 * gate `imagesFromRows` applies before it emits a PerekIllustration.
 * COUNT(DISTINCT i.id) keeps variant/format/size rows from multiplying
 * the total.
 */
const DISPLAYABLE_ILLUSTRATIONS_SQL = `
	SELECT COUNT(DISTINCT i.id) AS c
	FROM tanah_perek_image i
	JOIN tanah_perek_image_variant v
		ON v.image_id = i.id AND v.role = 'display' AND v.format = 'webp'
	WHERE i.is_active = 1
`;

/**
 * Fetch the totals with aggregate queries (no row loading).
 * Rejects on failure — a data failure must not surface as a zero count.
 */
export async function getPerekStats(): Promise<PerekStats> {
	try {
		const [articles, pediaEntries, illustrations] = await Promise.all([
			query<{ c: number }>(
				"SELECT COUNT(*) AS c FROM tanah_article WHERE perek_id BETWEEN 1 AND 929",
			),
			query<{ c: number }>(MEANINGFUL_PEDIA_ENTRIES_SQL),
			query<{ c: number }>(DISPLAYABLE_ILLUSTRATIONS_SQL),
		]);
		return {
			articles: Number(articles[0]?.c ?? 0),
			pediaEntries: Number(pediaEntries[0]?.c ?? 0),
			illustrations: Number(illustrations[0]?.c ?? 0),
			recordedPerakim: countRecordedPerakim(),
			programmeYears: getProgrammeYearsElapsed(
				constructTsetAwareHDate(getCurrentDate()),
			),
		};
	} catch (error) {
		console.warn(
			"Failed to fetch perek stats:",
			error instanceof Error ? error.message : error,
		);
		throw error;
	}
}
