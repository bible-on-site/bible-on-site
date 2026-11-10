"use server";

import type { Article, ArticleSummary } from "@/lib/articles";
import {
	getArticleById,
	getArticleHebrewDateOverride,
	getArticleSummariesByPerekId,
	getArticleSummariesByPerekIds,
} from "@/lib/articles";
import type { BookshelfDedicationLines } from "@/lib/dedications/loaders";
import { formatDedication } from "@/lib/dedications/types";
import { ExportError } from "@/lib/download/export-error";
import type {
	PageRangesDownloadContext,
	SeferDownloadContext,
	SemanticPageInfo,
} from "@/lib/download/types";
import type { PerushNote, PerushSummary } from "@/lib/perushim";
import {
	getPerushimByPerekId,
	getPerushimByPerekIds,
	getPerushNotes,
	getPerushNotesBatch,
} from "@/lib/perushim";
import {
	getArticleProgressUnits,
	getPerekMetrics,
	getPerekProgressUnitsBatch,
	getPerushProgressUnitsBatch,
	metricOrFallback,
	type ReadingMetric,
} from "@/lib/reading-metrics";
import type { ReadingProgressUnit } from "@/lib/reading-metrics/types";
import {
	articleDateOverridesTag,
	COLLECTION_TAGS,
	cachedPerKey,
} from "@/lib/revalidate/tags";
import { decorateArticleContent } from "@/lib/tanahpedia/article-mention-refs";

/**
 * The article assigned to one recurring Hebrew month/day (server action,
 * #3098) — the day's sole article on its resolved daily perek, or null when
 * the date has no assignment. Cached per month/day under the
 * `article-date-overrides` + `articles` tags so admin edits and assignment
 * changes expire it; `false` revalidate keeps it out of ISR clocks.
 */
const getCachedDateOverride = cachedPerKey(
	"article-date-override",
	(month: number, day: number) => `${month}:${day}`,
	() => [COLLECTION_TAGS.articles, articleDateOverridesTag],
	(month: number, day: number) => getArticleHebrewDateOverride(month, day),
);

/**
 * Client-facing override lookup for the daily article slot (#3098). Validates
 * the uniform month/day before querying — an out-of-range date is a client
 * bug and must surface as an error, not a silent empty result.
 */
export async function getDailyArticleOverride(
	hebrewMonth: number,
	hebrewDay: number,
): Promise<ArticleSummary | null> {
	const maxDay = MAX_DAY_FOR_HEBREW_MONTH[hebrewMonth];
	if (!maxDay || hebrewDay < 1 || hebrewDay > maxDay) {
		throw new Error(
			`Invalid Hebrew date ${hebrewMonth}/${hebrewDay} — month 1-14, day within the month's real maximum`,
		);
	}
	return getCachedDateOverride(hebrewMonth, hebrewDay);
}

/**
 * Maximum day each uniform Hebrew month can reach in some year: Cheshvan and
 * Kislev vary 29/30 so 30 stays valid input for them; Tevet, non-leap Adar,
 * Iyar, Tammuz, Elul and Adar II never reach 30 (#3098).
 */
const MAX_DAY_FOR_HEBREW_MONTH: Record<number, number> = {
	1: 30,
	2: 30,
	3: 30,
	4: 29,
	5: 30,
	6: 29,
	7: 30,
	8: 29,
	9: 30,
	10: 29,
	11: 30,
	12: 29,
	13: 30,
	14: 29,
};

/**
 * Fetch a single article by ID for in-book display (e.g. flipbook blank page).
 * Returns null if not found. Content arrives mention-decorated (#2516) so
 * in-book rendering matches the standalone article route; the article's own
 * dedication lines ride along for the same reason (#2731).
 */
export async function getArticleForBook(
	articleId: number,
): Promise<{ article: Article; dedicationLines: string[] } | null> {
	const article = await getArticleById(articleId);
	if (!article) return null;
	const { getArticleDedications } = await import("@/lib/dedications/loaders");
	return {
		article: await decorateArticleContent(article),
		dedicationLines: (await getArticleDedications(articleId)).map(
			formatDedication,
		),
	};
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
 * Stored readable-block units for an in-book article's scroll progress
 * (#2607) — same block rows as the standalone article route, keyed
 * positionally (`key: null`); the view segments the rendered body.
 */
export async function getArticleProgressUnitsForBook(
	articleId: number,
): Promise<ReadingProgressUnit[]> {
	return getArticleProgressUnits(articleId);
}

/**
 * Stored note-level units for several perushim on one perek (server
 * action) — the Sefer commentary pane weights scroll progress by each
 * note's stored word count. Keys are perush ids.
 */
export async function getNoteProgressUnitsForPerekBatch(
	perekId: number,
	perushIds: number[],
): Promise<Record<number, ReadingProgressUnit[]>> {
	const batch = await getPerushProgressUnitsBatch(perekId, perushIds);
	return Object.fromEntries(batch);
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
	/** Stored per-pasuk units for the flipbook page's progress bar (#2607). */
	pasukUnits: ReadingProgressUnit[];
	/** Stored perek-level metric for the flipbook page's badge (#2607). */
	perekMetric: ReadingMetric | null;
}

/**
 * Batch-fetch article and perushim summaries for multiple perakim in one call.
 * Returns a record keyed by perekId (as string, for serialization).
 */
export async function getPerekSummariesBatch(
	perekIds: number[],
): Promise<Record<string, PerekSummaries>> {
	// Metric reads only decorate summaries — a flaky metric query must not
	// reject the whole batch and hide the articles/perushim beneath it.
	// One grouped query per service for the whole sefer — per-perek
	// fan-out over a 5-connection pool turned a large sefer's book open
	// (Tehillim: 150 perakim) into hundreds of serialized round-trips.
	const [pasukUnits, perekMetrics, articlesByPerek, perushimByPerek] =
		await Promise.all([
			metricOrFallback(
				"perek progress units",
				new Map<number, ReadingProgressUnit[]>(),
				() => getPerekProgressUnitsBatch(perekIds),
			),
			metricOrFallback("perek metrics", new Map<number, ReadingMetric>(), () =>
				getPerekMetrics(perekIds),
			),
			getArticleSummariesByPerekIds(perekIds),
			getPerushimByPerekIds(perekIds),
		]);
	return Object.fromEntries(
		perekIds.map((id) => [
			String(id),
			{
				articles: articlesByPerek.get(id) ?? [],
				perushim: perushimByPerek.get(id) ?? [],
				pasukUnits: pasukUnits.get(id) ?? [],
				perekMetric: perekMetrics.get(id) ?? null,
			},
		]),
	);
}

/**
 * The bookshelf's helek/sefer dedication lines (#2731), loaded on demand by
 * the in-reader sefarim picker — the modal opens client-side after mount,
 * so its dedication view arrives through the tag-cached loader.
 */
export async function getBookshelfDedicationLines(): Promise<BookshelfDedicationLines> {
	const { getBookshelfDedicationLines: load } = await import(
		"@/lib/dedications/loaders"
	);
	return load();
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
