import { assetsUrl } from "../assets-url";
import { query } from "../api-client";
import {
	getArticleMetrics,
	metricOrFallback,
	type ReadingMetric,
} from "../reading-metrics";
import type { AuthorArticle, AuthorDetails } from "./types";
import { normalizeAuthorName } from "./url-utils";

interface AuthorRow {
	id: number;
	name: string;
	details: string;
}

interface ArticleRow {
	id: number;
	perek_id: number;
	name: string;
	abstract: string | null;
}

// Track if we've already warned about S3 unavailability (avoid spam)
let s3WarningShown = false;

/**
 * Check if S3/RustFS is available (dev environment only).
 * Logs a warning once if not available.
 */
async function checkS3Availability(): Promise<void> {
	if (s3WarningShown || process.env.NODE_ENV === "production") return;

	const S3_ENDPOINT = process.env.S3_ENDPOINT;
	if (!S3_ENDPOINT) return;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 1000);
	try {
		const response = await fetch(`${S3_ENDPOINT}/health/ready`, {
			signal: controller.signal,
		});
		if (!response.ok) throw new Error("RustFS is not ready");
	} catch {
		s3WarningShown = true;
		console.warn(
			"⚠️  S3/RustFS not available at",
			S3_ENDPOINT,
			"- Author images will not load.",
			"\n   Start Docker and run: docker compose -f devops/docker-compose.yml up -d rustfs",
		);
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Build the public URL for author images based on author ID.
 * Images are stored in S3 with naming convention: authors/high-res/{id}.jpg
 * Handles CDN, RustFS (dev) and AWS S3 (prod) URLs.
 */
export function getAuthorImageUrl(authorId: number): string {
	// Check S3 availability asynchronously (fire-and-forget, logs warning if down)
	checkS3Availability();

	return assetsUrl(`authors/high-res/${authorId}.jpg`);
}

/**
 * Fetch author by ID with full details
 */
export async function getAuthorById(id: number): Promise<AuthorDetails | null> {
	try {
		const rows = await query<AuthorRow>(
			`SELECT id, name, details
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
			imageUrl: getAuthorImageUrl(row.id),
		};
	} catch (error) {
		console.warn(
			`Failed to fetch author ${id}:`,
			error instanceof Error ? error.message : error,
		);
		throw error;
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
			 WHERE author_id = ? AND perek_id BETWEEN 1 AND 929
			 ORDER BY perek_id ASC`,
			[authorId],
		);

		const articles = rows.map((row) => ({
			id: row.id,
			perekId: row.perek_id,
			name: row.name,
			abstract: row.abstract,
		}));
		// Stored reading metrics decorate the abstract list (#2607) — the same
		// optional-decoration contract as the article service: a failed metric
		// read must not hide the loaded articles.
		const metrics = await metricOrFallback(
			`author ${authorId} article metrics`,
			new Map<number, ReadingMetric>(),
			() => getArticleMetrics(articles.map((a) => a.id)),
		);
		return articles.map((article) => {
			const metric = metrics.get(article.id);
			return metric ? { ...article, metric } : article;
		});
	} catch (error) {
		console.warn(
			`Failed to fetch articles for author ${authorId}:`,
			error instanceof Error ? error.message : error,
		);
		throw error;
	}
}

/**
 * Get all author IDs for static generation
 */
export async function getAllAuthorIds(): Promise<number[]> {
	try {
		const rows = await query<{ id: number }>(
			`SELECT a.id FROM tanah_author a
			 WHERE EXISTS (SELECT 1 FROM tanah_article art WHERE art.author_id = a.id AND art.perek_id BETWEEN 1 AND 929)
			 ORDER BY a.id`,
		);
		return rows.map((row) => row.id);
	} catch (error) {
		console.warn(
			"Failed to fetch author IDs:",
			error instanceof Error ? error.message : error,
		);
		throw error;
	}
}

/**
 * Fetch an author whose normalised name matches the given (normalised) name.
 * The comparison strips problematic characters on both sides so that
 * `שליט"א` and `שליטא` match.
 */
export async function getAuthorByName(
	rawName: string,
): Promise<AuthorDetails | null> {
	try {
		const rows = await query<AuthorRow>(
			`SELECT id, name, details
			 FROM tanah_author
			 WHERE EXISTS (SELECT 1 FROM tanah_article art WHERE art.author_id = tanah_author.id AND art.perek_id BETWEEN 1 AND 929)`,
		);

		const needle = normalizeAuthorName(rawName);
		const match = rows.find((row) => normalizeAuthorName(row.name) === needle);

		if (!match) return null;

		return {
			id: match.id,
			name: match.name,
			details: match.details || "",
			imageUrl: getAuthorImageUrl(match.id),
		};
	} catch (error) {
		console.warn(
			`Failed to fetch author by name "${rawName}":`,
			error instanceof Error ? error.message : error,
		);
		throw error;
	}
}

/**
 * Get all authors (id + name) for static param generation.
 * Returns normalised name slugs alongside IDs.
 */
export async function getAllAuthorSlugs(): Promise<string[]> {
	try {
		const rows = await query<AuthorRow>(
			`SELECT a.id, a.name, a.details FROM tanah_author a
			 WHERE EXISTS (SELECT 1 FROM tanah_article art WHERE art.author_id = a.id AND art.perek_id BETWEEN 1 AND 929)
			 ORDER BY a.name ASC`,
		);
		return rows.map((row) => normalizeAuthorName(row.name));
	} catch (error) {
		console.warn(
			"Failed to fetch author slugs:",
			error instanceof Error ? error.message : error,
		);
		throw error;
	}
}
