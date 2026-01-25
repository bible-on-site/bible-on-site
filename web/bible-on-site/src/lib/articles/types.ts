/**
 * Article type matching the GraphQL API schema
 */
export interface Article {
	id: number;
	perekId: number;
	authorId: number;
	/** HTML content abstract of the article */
	abstract: string | null;
	name: string;
	priority: number;
}

/**
 * Author type for article attribution
 */
export interface Author {
	id: number;
	name: string;
}
