import { toLetters, toNumber } from "gematry";
import type { HistoryMapper, PageSemantics } from "html-flip-book-react";
import bookPageSlugs from "@/data/book-page-slugs.json";
import divisionData from "@/data/parasha/parasha-division.json";
import type { AuxiliaryReading, ScriptureRange } from "@/lib/reading/contract";

// The division root comes from the shared JSON so this module stays
// client-safe (the data module resolves the server-only corpus).
const PARASHA_ROOT = divisionData.rootPath;

/**
 * The parasha unit data a sefer book needs. Everything is plain
 * serializable data resolved server-side (the flipbook runs client-only
 * and cannot reach the canonical corpus).
 */
export interface ParashaBookHaftara extends AuxiliaryReading {
	note?: string;
	/** Scripture reference span(s), formatted server-side. */
	refSpan: string;
}

export interface ParashaBookUnit {
	unitId: number;
	name: string;
	order: number;
	/** Scripture reference span of the primary range, formatted server-side. */
	refSpan: string;
	ranges: ScriptureRange[];
	haftarot: ParashaBookHaftara[];
	notes: string[];
}

export const PARASHA_CONTENT_OFFSET = 3;
const TOC_PAGE_INDEX = PARASHA_CONTENT_OFFSET - 1;
const TOC_SPREAD_INDEX = TOC_PAGE_INDEX - 1;
const FRONT_COVER_INDEX = 0;

export type BookPage = keyof typeof bookPageSlugs;

/** Public book-chrome route for the פרשה sefer book (rewritten to the sefer's first parasha). */
export function parashaBookPageRoute(
	seferName: string,
	page: BookPage,
): string {
	return `${PARASHA_ROOT}/${seferName}/${bookPageSlugs[page]}?book`;
}

export function parashaBookPageFromQuery(
	value: string | null,
): BookPage | null {
	if (!value) return null;
	return (
		(Object.keys(bookPageSlugs) as BookPage[]).find(
			(page) => page === value || bookPageSlugs[page] === value,
		) ?? null
	);
}

/**
 * Book-chrome page embedded in a /פרשה path (`/פרשה/{sefer}/{slug}`).
 * Unknown or non-book paths resolve to null.
 */
export function parashaBookPageFromPath(pathname: string): BookPage | null {
	const segments = decodeURIComponent(pathname).split("/").filter(Boolean);
	if (
		segments.length !== 3 ||
		(segments[0] !== "פרשה" && segments[0] !== "parasha")
	) {
		return null;
	}
	const slug = segments[2];
	return (
		(Object.keys(bookPageSlugs) as BookPage[]).find(
			(page) => bookPageSlugs[page] === slug,
		) ?? null
	);
}

/**
 * Page semantics for the פרשה sefer book: each parasha contributes a
 * Torah page (named by its order numeral) followed by a Haftarah page.
 * Titles feed the table of contents — every parasha and every Haftarah
 * is directly reachable.
 */
export function buildParashaPageSemantics(
	units: ParashaBookUnit[],
): PageSemantics {
	return {
		indexToSemanticName(pageIndex: number): string {
			if (pageIndex < PARASHA_CONTENT_OFFSET) return "";
			const adjusted = pageIndex - PARASHA_CONTENT_OFFSET;
			if (adjusted % 2 !== 0) return "";
			const unitIdx = adjusted / 2;
			if (unitIdx >= units.length) return "";
			return toLetters(units[unitIdx].order);
		},
		semanticNameToIndex(semanticPageName: string): number | null {
			const num = toNumber(semanticPageName);
			if (num === 0) return null;
			const idx = units.findIndex((unit) => unit.order === num);
			if (idx < 0) return null;
			return idx * 2 + PARASHA_CONTENT_OFFSET;
		},
		indexToTitle(pageIndex: number): string {
			if (pageIndex < PARASHA_CONTENT_OFFSET) return "";
			const adjusted = pageIndex - PARASHA_CONTENT_OFFSET;
			const unitIdx = Math.floor(adjusted / 2);
			if (unitIdx >= units.length) return "";
			const unit = units[unitIdx];
			return adjusted % 2 === 0 ? `פרשת ${unit.name}` : `הפטרת ${unit.name}`;
		},
	};
}

/**
 * URL <-> leaf mapping for the פרשה book. Torah pages live at
 * `/פרשה/{unitId}?book`; Haftarah pages at `/פרשה/{unitId}?book&haftara`;
 * book chrome reuses the shared cover/contents/back slugs under
 * `/פרשה/{sefer}/{slug}?book`.
 */
export function buildParashaHistoryMapper(
	units: ParashaBookUnit[],
	seferName: string,
): HistoryMapper {
	const backCoverIndex = PARASHA_CONTENT_OFFSET + units.length * 2;
	return {
		pageToRoute: (pageIndex) => {
			if (!units.length) return null;
			if (pageIndex === FRONT_COVER_INDEX) {
				return parashaBookPageRoute(seferName, "front");
			}
			if (pageIndex === TOC_SPREAD_INDEX || pageIndex === TOC_PAGE_INDEX) {
				return parashaBookPageRoute(seferName, "toc");
			}
			if (pageIndex === backCoverIndex) {
				return parashaBookPageRoute(seferName, "back");
			}
			if (pageIndex < PARASHA_CONTENT_OFFSET) return null;
			const adjusted = pageIndex - PARASHA_CONTENT_OFFSET;
			const unitIdx = Math.floor(adjusted / 2);
			const unit = units[Math.min(unitIdx, units.length - 1)];
			return `${PARASHA_ROOT}/${unit.unitId}?book${
				adjusted % 2 !== 0 ? "&haftara" : ""
			}`;
		},
		routeToPage: (route) => {
			if (!units.length) return null;
			const [pathname, query = ""] = route.split("?");
			const params = new URLSearchParams(query);
			if (!params.has("book")) return null;
			const bookPage = parashaBookPageFromPath(pathname);
			if (bookPage === "front") return FRONT_COVER_INDEX;
			if (bookPage === "toc") return TOC_SPREAD_INDEX;
			if (bookPage === "back") return backCoverIndex;
			const match = decodeURIComponent(pathname).match(
				/\/(?:פרשה|parasha)\/(\d+)/,
			);
			if (match) {
				const unitId = Number.parseInt(match[1], 10);
				const idx = units.findIndex((unit) => unit.unitId === unitId);
				if (idx >= 0) {
					return (
						idx * 2 + PARASHA_CONTENT_OFFSET + (params.has("haftara") ? 1 : 0)
					);
				}
			}
			return null;
		},
	};
}

export function computeParashaInitialTurnedLeaves(
	units: ParashaBookUnit[],
	unitId: number,
	haftara: boolean,
): number[] | undefined {
	const idx = units.findIndex((unit) => unit.unitId === unitId);
	if (idx < 0) return undefined;
	const pageIndex = idx * 2 + PARASHA_CONTENT_OFFSET + (haftara ? 1 : 0);
	const turnedCount = Math.ceil(pageIndex / 2);
	return Array.from({ length: turnedCount }, (_, i) => i);
}

/**
 * Merge `?book` into the current query string for the פרשה reader;
 * preserves other params, drops parasha book params when leaving the
 * book view.
 */
export function pathnameWithParashaBookQuery(
	pathname: string,
	currentSearch: string,
	wantBook: boolean,
): string {
	const params = new URLSearchParams(
		currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch,
	);
	if (wantBook) {
		params.set("book", "");
	} else {
		params.delete("book");
		params.delete("haftara");
		params.delete("toc");
		params.delete("bookPage");
	}
	const q = params.toString();
	return q.length > 0 ? `${pathname}?${q}` : pathname;
}
