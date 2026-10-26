"use server";

import type { Article, ArticleSummary } from "@/lib/articles";
import { getArticleById, getArticleSummariesByPerekId } from "@/lib/articles";
import { ExportError } from "@/lib/download/export-error";
import type {
	PageRangesDownloadContext,
	SeferDownloadContext,
	SemanticPageInfo,
} from "@/lib/download/types";
import type { PerushNote, PerushSummary } from "@/lib/perushim";
import {
	getPerushimByPerekId,
	getPerushNotes,
	getPerushNotesBatch,
} from "@/lib/perushim";
import { decorateArticleContent } from "@/lib/tanahpedia/article-mention-refs";

/**
 * Fetch a single article by ID for in-book display (e.g. flipbook blank page).
 * Returns null if not found. Content arrives mention-decorated (#2516) so
 * in-book rendering matches the standalone article route.
 */
export async function getArticleForBook(
	articleId: number,
): Promise<Article | null> {
	const article = await getArticleById(articleId);
	if (!article) return null;
	return decorateArticleContent(article);
}

/**
 * Fetch perush notes for a specific perush on a specific perek (server action).
 */
export async function getPerushNotesForPage(
	perushId: number,
	perekId: number,
): Promise<PerushNote[]> {
	return getPerushNotes(perushId, perekId);
}

/**
 * Fetch notes for several perushim on one perek in a single query (server
 * action) — the Sefer commentary panel shows every selected perush at once.
 * Keys are perush ids; a perush with no notes on the perek has no key.
 */
export async function getPerushNotesForPerekBatch(
	perekId: number,
	perushIds: number[],
): Promise<Record<number, PerushNote[]>> {
	return getPerushNotesBatch(perekId, perushIds);
}

/**
 * Fetch article summaries for a perek (no full content) for book view carousel.
 */
export async function getArticleSummariesForPerek(
	perekId: number,
): Promise<ArticleSummary[]> {
	return getArticleSummariesByPerekId(perekId);
}

/**
 * Fetch perushim summaries for a perek for book view carousel.
 */
export async function getPerushimSummariesForPerek(
	perekId: number,
): Promise<PerushSummary[]> {
	return getPerushimByPerekId(perekId);
}

/** Summaries for a single perek (articles + perushim metadata). */
export interface PerekSummaries {
	articles: ArticleSummary[];
	perushim: PerushSummary[];
}

/**
 * Batch-fetch article and perushim summaries for multiple perakim in one call.
 * Returns a record keyed by perekId (as string, for serialization).
 */
export async function getPerekSummariesBatch(
	perekIds: number[],
): Promise<Record<string, PerekSummaries>> {
	const entries = await Promise.all(
		perekIds.map(async (id) => {
			const [articles, perushim] = await Promise.all([
				getArticleSummariesByPerekId(id),
				getPerushimByPerekId(id),
			]);
			return [String(id), { articles, perushim }] as const;
		}),
	);
	return Object.fromEntries(entries);
}

/** Result of a download action when a handler is implemented */
export interface DownloadActionResult {
	ext: string;
	/** Base64-encoded file content */
	data: string;
}

/** Result when download cannot be performed */
export interface DownloadActionError {
	error: "not_implemented" | "service_unavailable";
	/** Reader-facing reason, when the failure has an actionable one. */
	message?: string;
}

function downloadFailure(e: unknown): DownloadActionError {
	return e instanceof ExportError
		? { error: "service_unavailable", message: e.message }
		: { error: "service_unavailable" };
}

/**
 * Sefer download action. Uses the registered SeferDownloadHandler if set.
 */
export async function downloadSefer(
	ctx: SeferDownloadContext,
): Promise<DownloadActionResult | DownloadActionError> {
	const { getSeferDownloadHandler } = await import("@/lib/download/handlers");
	const handler = getSeferDownloadHandler();
	if (!handler) {
		return { error: "not_implemented" };
	}
	try {
		const [ext, bin] = await handler(ctx);
		const data = Buffer.from(bin).toString("base64");
		return { ext, data };
	} catch (e) {
		console.error("Sefer download failed:", e);
		return downloadFailure(e);
	}
}

/**
 * Page-ranges download action. Uses the registered PageRangesDownloadHandler if set.
 * Pass page indices and semantic page info; optional context (e.g. seferName) for handlers.
 */
export async function downloadPageRanges(
	pages: number[],
	semanticPages: SemanticPageInfo[],
	context?: PageRangesDownloadContext,
): Promise<DownloadActionResult | DownloadActionError> {
	const { getPageRangesDownloadHandler } = await import(
		"@/lib/download/handlers"
	);
	const handler = getPageRangesDownloadHandler();
	if (!handler) {
		return { error: "not_implemented" };
	}
	try {
		const [ext, bin] = await handler(pages, semanticPages, context);
		const data = Buffer.from(bin).toString("base64");
		return { ext, data };
	} catch (e) {
		console.error("Page-ranges download failed:", e);
		return downloadFailure(e);
	}
}
