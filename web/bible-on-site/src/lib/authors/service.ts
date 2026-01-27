import { query } from "../api-client";
import type { AuthorArticle, AuthorDetails } from "./types";

interface AuthorRow {
	id: number;
	name: string;
	details: string;
	image_url: string | null;
}

interface ArticleRow {
	id: number;
	perek_id: number;
	name: string;
	abstract: string | null;
}

/**
 * Build the public URL for author images based on environment configuration.
 * Handles both LocalStack (dev) and AWS S3 (prod) URLs.
 */
export function getAuthorImageUrl(imageUrl: string | null): string | null {
	if (!imageUrl) return null;

	// If the URL is already a full URL, return as-is
	if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
		return imageUrl;
	}

	// Build URL from S3 configuration
	const S3_ENDPOINT = process.env.S3_ENDPOINT;
	const S3_BUCKET = process.env.S3_BUCKET || "bible-on-site-rabbis";
	const S3_REGION =
		process.env.S3_REGION || process.env.AWS_REGION || "us-east-1";

	if (S3_ENDPOINT) {
		// LocalStack/MinIO style URL
		return `${S3_ENDPOINT}/${S3_BUCKET}/${imageUrl}`;
	}
	// Standard AWS S3 URL
	return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${imageUrl}`;
}

/**
 * Fetch author by ID with full details
 */
export async function getAuthorById(id: number): Promise<AuthorDetails | null> {
	try {
		const rows = await query<AuthorRow>(
			`SELECT id, name, details, image_url
			 FROM tanah_author
			 WHERE id = ?`,
			[id],
		);

		if (rows.length === 0) {
			return null;
		}

		const row = rows[0];
		return {
			id: row.id,
			name: row.name,
			details: row.details || "",
			imageUrl: getAuthorImageUrl(row.image_url),
		};
	} catch (error) {
		console.warn(
			`Failed to fetch author ${id}:`,
			error instanceof Error ? error.message : error,
		);
		return null;
	}
}

/**
 * Fetch all articles by an author
 */
export async function getArticlesByAuthorId(
	authorId: number,
): Promise<AuthorArticle[]> {
	try {
		const rows = await query<ArticleRow>(
			`SELECT id, perek_id, name, abstract
			 FROM tanah_article
			 WHERE author_id = ?
			 ORDER BY perek_id ASC`,
			[authorId],
		);

		return rows.map((row) => ({
			id: row.id,
			perekId: row.perek_id,
			name: row.name,
			abstract: row.abstract,
		}));
	} catch (error) {
		console.warn(
			`Failed to fetch articles for author ${authorId}:`,
			error instanceof Error ? error.message : error,
		);
		return [];
	}
}

/**
 * Get all author IDs for static generation
 */
export async function getAllAuthorIds(): Promise<number[]> {
	try {
		const rows = await query<{ id: number }>(
			`SELECT id FROM tanah_author ORDER BY id`,
		);
		return rows.map((row) => row.id);
	} catch (error) {
		console.warn(
			"Failed to fetch author IDs:",
			error instanceof Error ? error.message : error,
		);
		return [];
	}
}
