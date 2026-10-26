import type { ReadingMetric } from "../reading-metrics";

/**
 * Article type with author information for display
 */
export interface Article {
	id: number;
	perekId: number;
	authorId: number;
	/** HTML content abstract of the article */
	abstract: string | null;
	/** Full HTML content of the article */
	content: string | null;
	name: string;
	priority: number;
	/** Author name for display */
	authorName: string;
	/** Author image URL from S3 */
	authorImageUrl: string;
	/**
	 * Stored reading metric over the FULL article content (#2607) — the same
	 * number shown before entry and on the article page. `null`/absent means
	 * the metric is not computed yet; a verified-empty body carries zeros.
	 */
	metric?: ReadingMetric | null;
}

/**
 * Lightweight article summary for carousel display (no full content).
 */
export interface ArticleSummary {
	id: number;
	perekId: number;
	authorId: number;
	abstract: string | null;
	name: string;
	priority: number;
	authorName: string;
	authorImageUrl: string;
	/** Stored full-content reading metric — see {@link Article.metric}. */
	metric?: ReadingMetric | null;
}

/**
 * Author type for article attribution
 */
export interface Author {
	id: number;
	name: string;
}
