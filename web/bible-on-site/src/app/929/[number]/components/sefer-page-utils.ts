import { toLetters, toNumber } from "gematry";
import type { HistoryMapper, PageSemantics } from "html-flip-book-react";
import bookPageSlugs from "@/data/book-page-slugs.json";

const CONTENT_OFFSET = 3;
const TOC_PAGE_INDEX = CONTENT_OFFSET - 1;
const TOC_SPREAD_INDEX = TOC_PAGE_INDEX - 1;
const FRONT_COVER_INDEX = 0;

export type BookPage = keyof typeof bookPageSlugs;

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
	const bookRoute = (page: BookPage) =>
		`/929/${seferName}/${bookPageSlugs[page]}?book`;
	const backCoverIndex = CONTENT_OFFSET + (perekIds?.length ?? 0) * 2;
	return {
		pageToRoute: (pageIndex, _semantic) => {
			if (!perekIds?.length) return null;
			if (pageIndex === FRONT_COVER_INDEX) return bookRoute("front");
			if (pageIndex === TOC_SPREAD_INDEX || pageIndex === TOC_PAGE_INDEX) {
				return bookRoute("toc");
			}
			if (perekIds?.length && pageIndex === backCoverIndex)
				return bookRoute("back");
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

export function wrapDownloadResult(
	r: { ext: string; data: string } | { error: string },
): { ext: string; data: string } | null {
	return "error" in r ? null : { ext: r.ext, data: r.data };
}

export { CONTENT_OFFSET };
