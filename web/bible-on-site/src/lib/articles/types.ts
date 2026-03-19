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
}

/**
 * Author type for article attribution
 */
export interface Author {
	id: number;
	name: string;
}
