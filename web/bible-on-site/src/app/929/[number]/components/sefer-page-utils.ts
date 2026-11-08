import { toLetters, toNumber } from "gematry";
import type { HistoryMapper, PageSemantics } from "html-flip-book-react";
import bookPageSlugs from "@/data/book-page-slugs.json";

const CONTENT_OFFSET = 3;
const TOC_PAGE_INDEX = CONTENT_OFFSET - 1;
const TOC_SPREAD_INDEX = TOC_PAGE_INDEX - 1;
const FRONT_COVER_INDEX = 0;

export type BookPage = keyof typeof bookPageSlugs;

export function bookPageRoute(seferName: string, page: BookPage): string {
	return `/929/${seferName}/${bookPageSlugs[page]}?book`;
}

export function bookPageFromQuery(value: string | null): BookPage | null {
	if (!value) return null;
	return (
		(Object.keys(bookPageSlugs) as BookPage[]).find(
			(page) => page === value || bookPageSlugs[page] === value,
		) ?? null
	);
}

export function bookPageFromPath(
	pathname: string,
	seferName?: string,
): BookPage | null {
	const segments = decodeURIComponent(pathname).split("/").filter(Boolean);
	if (
		seferName &&
		(segments.length !== 3 ||
			segments[0] !== "929" ||
			segments[1] !== seferName)
	)
		return null;
	const slug = segments.at(-1);
	return (
		(Object.keys(bookPageSlugs) as BookPage[]).find(
			(page) => bookPageSlugs[page] === slug,
		) ?? null
	);
}

/**
 * Flat route to land on when the user leaves the sefer book. While the
 * book is open the flipbook owns browser history — window.location
 * names the perek the user actually reached, which the router's stale
 * pathname cannot see. Book-chrome exits and paths without a perek id
 * fall back to the perek the book was opened from.
 */
export function seferBookExitPath(
	pathname: string,
	seferName: string,
	fallbackPerekId: number,
): string {
	if (bookPageFromPath(pathname, seferName)) {
		return `/929/${fallbackPerekId}`;
	}
	const match = pathname.match(/\/929\/(\d+)/);
	return match ? `/929/${match[1]}` : `/929/${fallbackPerekId}`;
}

export function toHebrewChapterNumber(num: number): string {
	return toLetters(num);
}

export function buildPageSemantics(
	perakimLength: number,
	perekHeaders: Array<string | undefined>,
): PageSemantics {
	return {
		indexToSemanticName(pageIndex: number): string {
			if (pageIndex < CONTENT_OFFSET) return "";
			const adjusted = pageIndex - CONTENT_OFFSET;
			if (adjusted % 2 !== 0) return "";
			const perekNum = adjusted / 2 + 1;
			if (perekNum > perakimLength) return "";
			return toHebrewChapterNumber(perekNum);
		},
		semanticNameToIndex(semanticPageName: string): number | null {
			const num = toNumber(semanticPageName);
			if (num === 0) return null;
			if (num > perakimLength) return null;
			return (num - 1) * 2 + CONTENT_OFFSET;
		},
		indexToTitle(pageIndex: number): string {
			if (pageIndex < CONTENT_OFFSET) return "";
			const adjusted = pageIndex - CONTENT_OFFSET;
			if (adjusted % 2 !== 0) return "";
			const perekIdx = adjusted / 2;
			if (perekIdx >= perakimLength) return "";
			return (
				perekHeaders[perekIdx] || `פרק ${toHebrewChapterNumber(perekIdx + 1)}`
			);
		},
	};
}

export function buildHistoryMapper(
	perekIds: number[] | undefined,
	pageSemantics: PageSemantics,
	seferName: string,
): HistoryMapper {
	const backCoverIndex = CONTENT_OFFSET + (perekIds?.length ?? 0) * 2;
	return {
		pageToRoute: (pageIndex, _semantic) => {
			if (!perekIds?.length) return null;
			if (pageIndex === FRONT_COVER_INDEX)
				return bookPageRoute(seferName, "front");
			if (pageIndex === TOC_SPREAD_INDEX || pageIndex === TOC_PAGE_INDEX) {
				return bookPageRoute(seferName, "toc");
			}
			if (perekIds?.length && pageIndex === backCoverIndex)
				return bookPageRoute(seferName, "back");
			if (pageIndex < CONTENT_OFFSET) return null;
			const perekIdx = Math.floor((pageIndex - CONTENT_OFFSET) / 2);
			const clampedIdx = Math.min(perekIdx, (perekIds?.length ?? 1) - 1);
			const id = perekIds?.[clampedIdx];
			if (id == null) return null;
			return `/929/${id}?book`;
		},
		routeToPage: (route) => {
			if (!perekIds?.length) return null;
			const [pathname, query = ""] = route.split("?");
			const params = new URLSearchParams(query);
			if (params.has("book")) {
				const bookPage = bookPageFromPath(pathname, seferName);
				if (bookPage === "front") return FRONT_COVER_INDEX;
				if (bookPage === "toc") return TOC_SPREAD_INDEX;
				if (bookPage === "back") return backCoverIndex;
				const m = route.match(/\/929\/(\d+)/);
				if (m) {
					const id = Number.parseInt(m[1], 10);
					const idx = perekIds?.indexOf(id) ?? -1;
					if (idx >= 0)
						return params.has("toc")
							? TOC_SPREAD_INDEX
							: idx * 2 + CONTENT_OFFSET;
				}
			}
			const perekOnlyMatch = route.match(/^\/929\/(\d+)$/);
			if (perekOnlyMatch) {
				const id = Number.parseInt(perekOnlyMatch[1], 10);
				const idx = perekIds?.indexOf(id) ?? -1;
				if (idx >= 0) return idx * 2 + CONTENT_OFFSET;
			}
			const hashMatch = route.match(/#page\/(.+)/);
			if (hashMatch) {
				return pageSemantics.semanticNameToIndex(hashMatch[1]);
			}
			return null;
		},
	};
}

export function computeInitialTurnedLeaves(
	perekIds: number[] | undefined,
	currentPerekId: number,
): number[] | undefined {
	const idx = perekIds?.indexOf(currentPerekId) ?? -1;
	if (idx < 0) return undefined;
	const pageIndex = idx * 2 + CONTENT_OFFSET;
	const turnedCount = Math.ceil(pageIndex / 2);
	return Array.from({ length: turnedCount }, (_, i) => i);
}

type DownloadActionOutcome =
	| { ext: string; data: string }
	| { error: string; message?: string };

export const DOWNLOAD_FAILED_MESSAGE =
	"יצירת קובץ ה-PDF נכשלה. נסו להוריד שוב בעוד רגע.";

/**
 * Failure handed to the flip-book download lifecycle: the library catches the
 * rejection and keeps the menu open with an accessible error and a working
 * retry path. Only this error's message is reader-facing safe text; internal
 * errors must not leak their message into the UI.
 */
export class DownloadFailedError extends Error {
	override name = "DownloadFailedError";
}

/**
 * DownloadConfig.onDownloadError for the sefer reader — keeps the app's
 * Hebrew/domain error mapping inside the library's error surface. A
 * DownloadFailedError already carries the safe action text; anything else
 * (library internals, malformed payloads, unexpected rejections) falls back
 * to the generic failure message rather than leaking an unsafe message.
 */
export function downloadErrorMessage(error: unknown): string {
	return error instanceof DownloadFailedError && error.message
		? error.message
		: DOWNLOAD_FAILED_MESSAGE;
}

/**
 * Runs a download server action for the flip-book menu.
 * - resolves to the file payload so the library saves it and closes the menu;
 * - resolves to null when the export is intentionally unavailable
 *   (`not_implemented`), which the library treats as cancellation;
 * - rejects with a DownloadFailedError carrying the action's safe message on
 *   an actual failure, so the menu surfaces an accessible, retryable error
 *   instead of silently closing.
 */
export async function runDownload(
	action: () => Promise<DownloadActionOutcome>,
): Promise<{ ext: string; data: string } | null> {
	let outcome: DownloadActionOutcome | null;
	try {
		outcome = await action();
	} catch (e) {
		console.error("Download action failed:", e);
		throw new DownloadFailedError(DOWNLOAD_FAILED_MESSAGE);
	}
	// A resolved outcome outside the two documented shapes is a failure too —
	// `"error" in null` would otherwise leak a raw TypeError to the menu.
	if (outcome === null || typeof outcome !== "object") {
		console.error("Download action returned malformed outcome:", outcome);
		throw new DownloadFailedError(DOWNLOAD_FAILED_MESSAGE);
	}
	if ("error" in outcome) {
		if (outcome.error === "not_implemented") return null;
		throw new DownloadFailedError(outcome.message ?? DOWNLOAD_FAILED_MESSAGE);
	}
	if (!("ext" in outcome) || !("data" in outcome)) {
		console.error("Download action returned malformed outcome:", outcome);
		throw new DownloadFailedError(DOWNLOAD_FAILED_MESSAGE);
	}
	return { ext: outcome.ext, data: outcome.data };
}

export { CONTENT_OFFSET };
