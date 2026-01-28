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
}
