import type { ReadingMetric } from "../reading-metrics";

/**
 * Author type with full details for the authors page
 */
export interface AuthorDetails {
	id: number;
	name: string;
	details: string;
	imageUrl: string;
}

/**
 * Article summary for display on author page
 */
export interface AuthorArticle {
	id: number;
	perekId: number;
	name: string;
	abstract: string | null;
	/**
	 * Stored reading metric over the FULL article content (#2607) — shown
	 * beside the abstract so the pre-entry estimate matches the article
	 * page's. `null`/absent = not computed; zeros = verified empty.
	 */
	metric?: ReadingMetric | null;
}
