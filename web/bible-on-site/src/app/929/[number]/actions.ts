"use server";

import type { Article, ArticleSummary } from "@/lib/articles";
import { getArticleById, getArticleSummariesByPerekId } from "@/lib/articles";
import {
	getPageRangesDownloadHandler,
	getSeferDownloadHandler,
} from "@/lib/download/handlers";
import type {
	SeferDownloadContext,
	SemanticPageInfo,
} from "@/lib/download/types";
import type { PerushNote, PerushSummary } from "@/lib/perushim";
import { getPerushNotes, getPerushimByPerekId } from "@/lib/perushim";

/**
 * Fetch a single article by ID for in-book display (e.g. flipbook blank page).
 * Returns null if not found.
 */
export async function getArticleForBook(
	articleId: number,
): Promise<Article | null> {
	return getArticleById(articleId);
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
}

/**
 * Sefer download action. Uses the registered SeferDownloadHandler if set.
 */
export async function downloadSefer(
	ctx: SeferDownloadContext,
): Promise<DownloadActionResult | DownloadActionError> {
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
		return { error: "service_unavailable" };
	}
}

/**
 * Page-ranges download action. Uses the registered PageRangesDownloadHandler if set.
 * Pass page indices and semantic page info; optional context (e.g. seferName) for handlers.
 */
export async function downloadPageRanges(
	pages: number[],
	semanticPages: SemanticPageInfo[],
	context?: { seferName?: string },
): Promise<DownloadActionResult | DownloadActionError> {
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
		return { error: "service_unavailable" };
	}
}
