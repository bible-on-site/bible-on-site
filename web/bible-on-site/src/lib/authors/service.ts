import { query } from "../api-client";
import { assetsUrl } from "../assets-url";
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

// Inventory of the immutable PNGs staged in the shared production asset bucket.
const portraitRelease = "authors/caricatures/v20261126/high-res";
const releasedPortraitIds = new Set([
	1, 4, 5, 6, 7, 9, 10, 11, 12, 19, 20, 21, 22, 23, 24, 26, 27, 28, 31, 33, 34,
	35, 36, 37, 38, 39, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
	55, 56, 57, 58, 59, 60, 61, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74,
	75, 77, 78, 79, 80, 81,
]);

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
 * Resolve the website's versioned portraits and the legacy JPEG fallback.
 * The release lives in the public production bucket; local fixtures still use JPEGs.
 */
export function getAuthorImageUrl(authorId: number): string {
	// Check S3 availability asynchronously (fire-and-forget, logs warning if down)
	checkS3Availability();

	const bucket = process.env.S3_BUCKET || "bible-on-site-assets";
	if (
		process.env.NODE_ENV === "production" &&
		!process.env.S3_ENDPOINT &&
		bucket === "bible-on-site-assets" &&
		releasedPortraitIds.has(authorId)
	) {
		return assetsUrl(`${portraitRelease}/${authorId}.png`);
	}

	return assetsUrl(`authors/high-res/${authorId}.jpg`);
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
