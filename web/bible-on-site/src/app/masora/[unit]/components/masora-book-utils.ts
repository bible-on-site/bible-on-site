import { toLetters, toNumber } from "gematry";
import type { HistoryMapper, PageSemantics } from "html-flip-book-react";
import bookPageSlugs from "@/data/book-page-slugs.json";
import type { ScriptureRange } from "@/lib/reading/contract";
import { SITE_NAME } from "@/lib/seo/jsonld";

// The division root is the public Hebrew path; the ASCII route dir is
// accepted alongside it so internal and public routes resolve the same.
export const MASORA_ROOT = "/מסורה";
const MASORA_ROOT_ALIASES = ["/מסורה", "/masora"] as const;
const MASORA_MENU_LABEL = "מסורה על הפרק";

/**
 * The masora unit data a sefer book needs. Everything is plain
 * serializable data resolved server-side (the flipbook runs client-only
 * and cannot reach the canonical corpus).
 */
export interface MasoraBookUnit {
	unitId: number;
	/** Unit order within its sefer — the semantic page numeral. */
	order: number;
	/** Scripture reference span, formatted server-side (e.g. "בראשית א א-ה"). */
	heading: string;
	ranges: ScriptureRange[];
	closingBreak?: "ptuha" | "stuma" | null;
}

export const MASORA_CONTENT_OFFSET = 3;
const TOC_PAGE_INDEX = MASORA_CONTENT_OFFSET - 1;
const TOC_SPREAD_INDEX = TOC_PAGE_INDEX - 1;
const FRONT_COVER_INDEX = 0;
/** Pages one masora unit contributes: its text page + the facing blank. */
const PAGES_PER_UNIT = 2;

export type BookPage = keyof typeof bookPageSlugs;

/**
 * Public book-chrome route for a מסורה sefer book. The sefer's first
 * unit id sits in the path (`/מסורה/{firstUnitId}/{slug}?book`) so the
 * generic numeric rewrite resolves it — unlike /פרשה, masora units are
 * derived in TS and have no config-readable unit table.
 */
export function masoraBookPageRoute(
	firstUnitId: number,
	page: BookPage,
): string {
	return `${MASORA_ROOT}/${firstUnitId}/${bookPageSlugs[page]}?book`;
}

export function masoraBookPageFromQuery(
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
 * Book-chrome page embedded in a /מסורה path
 * (`/מסורה/{firstUnitId}/{slug}`). Unknown or non-book paths resolve
 * to null.
 */
export function masoraBookPageFromPath(pathname: string): BookPage | null {
	const segments = decodeURIComponent(pathname).split("/").filter(Boolean);
	if (
		segments.length !== 3 ||
		(segments[0] !== "מסורה" && segments[0] !== "masora") ||
		!/^\d+$/.test(segments[1])
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
 * Page semantics for the מסורה sefer book: each Masoretic unit
 * contributes a text page (named by its order numeral) followed by a
 * blank commentary page. Titles feed the table of contents — every
 * parasha is directly reachable by its reference-span heading; blank
 * pages share their text page's route and stay out of the TOC.
 */
export function buildMasoraPageSemantics(
	units: MasoraBookUnit[],
): PageSemantics {
	return {
		indexToSemanticName(pageIndex: number): string {
			if (pageIndex < MASORA_CONTENT_OFFSET) return "";
			const adjusted = pageIndex - MASORA_CONTENT_OFFSET;
			if (adjusted % PAGES_PER_UNIT !== 0) return "";
			const unitIdx = adjusted / PAGES_PER_UNIT;
			if (unitIdx >= units.length) return "";
			return toLetters(units[unitIdx].order);
		},
		semanticNameToIndex(semanticPageName: string): number | null {
			const num = toNumber(semanticPageName);
			if (num === 0) return null;
			const idx = units.findIndex((unit) => unit.order === num);
			if (idx < 0) return null;
			return idx * PAGES_PER_UNIT + MASORA_CONTENT_OFFSET;
		},
		indexToTitle(pageIndex: number): string {
			if (pageIndex < MASORA_CONTENT_OFFSET) return "";
			const adjusted = pageIndex - MASORA_CONTENT_OFFSET;
			if (adjusted % PAGES_PER_UNIT !== 0) return "";
			const unitIdx = adjusted / PAGES_PER_UNIT;
			if (unitIdx >= units.length) return "";
			return units[unitIdx].heading;
		},
	};
}

/**
 * URL <-> leaf mapping for the מסורה book. A unit's text page and its
 * facing blank share `/מסורה/{unitId}?book`; book chrome reuses the
 * shared cover/contents/back slugs under
 * `/מסורה/{firstUnitId}/{slug}?book` — the first unit id carries the
 * sefer resolution (masora units are derived in TS, so unlike /פרשה
 * there is no config-side sefer→unit table for name-based paths).
 */
export function buildMasoraHistoryMapper(
	units: MasoraBookUnit[],
): HistoryMapper {
	const backCoverIndex =
		MASORA_CONTENT_OFFSET + units.length * PAGES_PER_UNIT;
	const firstUnitId = units[0]?.unitId ?? 0;
	return {
		pageToRoute: (pageIndex) => {
			if (!units.length) return null;
			if (pageIndex === FRONT_COVER_INDEX) {
				return masoraBookPageRoute(firstUnitId, "front");
			}
			if (pageIndex === TOC_SPREAD_INDEX || pageIndex === TOC_PAGE_INDEX) {
				return masoraBookPageRoute(firstUnitId, "toc");
			}
			if (pageIndex === backCoverIndex) {
				return masoraBookPageRoute(firstUnitId, "back");
			}
			if (pageIndex < MASORA_CONTENT_OFFSET) return null;
			const adjusted = pageIndex - MASORA_CONTENT_OFFSET;
			const unitIdx = Math.floor(adjusted / PAGES_PER_UNIT);
			const unit = units[Math.min(unitIdx, units.length - 1)];
			return `${MASORA_ROOT}/${unit.unitId}?book`;
		},
		routeToPage: (route) => {
			if (!units.length) return null;
			const [pathname, query = ""] = route.split("?");
			const params = new URLSearchParams(query);
			if (!params.has("book")) return null;
			const bookPage = masoraBookPageFromPath(pathname);
			if (bookPage === "front") return FRONT_COVER_INDEX;
			if (bookPage === "toc") return TOC_SPREAD_INDEX;
			if (bookPage === "back") return backCoverIndex;
			const match = decodeURIComponent(pathname).match(
				/\/(?:מסורה|masora)\/(\d+)/,
			);
			if (match) {
				const unitId = Number.parseInt(match[1], 10);
				const idx = units.findIndex((unit) => unit.unitId === unitId);
				if (idx >= 0) return idx * PAGES_PER_UNIT + MASORA_CONTENT_OFFSET;
			}
			return null;
		},
	};
}

export function computeMasoraInitialTurnedLeaves(
	units: MasoraBookUnit[],
	unitId: number,
): number[] | undefined {
	const idx = units.findIndex((unit) => unit.unitId === unitId);
	if (idx < 0) return undefined;
	const pageIndex = idx * PAGES_PER_UNIT + MASORA_CONTENT_OFFSET;
	const turnedCount = Math.ceil(pageIndex / 2);
	return Array.from({ length: turnedCount }, (_, i) => i);
}

/**
 * Merge `?book` into the current query string for the מסורה reader;
 * preserves other params (a selected `perush`/`article` keeps its
 * meaning on the flat page), drops masora book chrome params when
 * leaving the book view.
 */
export function pathnameWithMasoraBookQuery(
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
		params.delete("toc");
		params.delete("bookPage");
	}
	const q = params.toString();
	return q.length > 0 ? `${pathname}?${q}` : pathname;
}

/**
 * Flat route to land on when the user leaves the מסורה book. While the
 * book is open the flipbook owns browser history — window.location
 * names the unit the user actually reached, which the router's stale
 * pathname cannot see. Book-chrome exits and paths without a unit id
 * fall back to the unit the book was opened from (the /929 reader's
 * behaviour).
 */
export function masoraBookExitPath(
	pathname: string,
	fallbackUnitId: number,
): string {
	if (masoraBookPageFromPath(pathname)) {
		return `${MASORA_ROOT}/${fallbackUnitId}`;
	}
	const match = decodeURIComponent(pathname).match(
		/\/(?:מסורה|masora)\/(\d+)/,
	);
	return match
		? `${MASORA_ROOT}/${match[1]}`
		: `${MASORA_ROOT}/${fallbackUnitId}`;
}

/** Title of a flat masora unit page, matching generateMetadata. */
export function masoraUnitDocumentTitle(heading: string): string {
	return `${heading} | ${MASORA_MENU_LABEL} | ${SITE_NAME}`;
}

/** Title of a perush open inside the masora book. */
export function masoraPerushDocumentTitle(
	perushName: string,
	unitHeading: string,
): string {
	return `${perushName} על ${unitHeading} | ${MASORA_MENU_LABEL} | ${SITE_NAME}`;
}

/**
 * Resolve the committed book page index to a document title, agreeing
 * with the history mapping: the front cover names the sefer, the
 * contents spread names the TOC, the back cover is marked, and a
 * unit's blank page carries the same heading title as its text page
 * (they share one route). Returns null for indices outside the book.
 */
export function buildMasoraDocumentTitleResolver(
	seferName: string,
	units: MasoraBookUnit[],
	backCoverPageIndex: number,
): (pageIndex: number) => string | null {
	return (pageIndex) => {
		if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
		if (pageIndex === FRONT_COVER_INDEX) {
			return `ספר ${seferName} | ${MASORA_MENU_LABEL} | ${SITE_NAME}`;
		}
		if (pageIndex < MASORA_CONTENT_OFFSET) {
			return `ספר ${seferName} - תוכן העניינים | ${MASORA_MENU_LABEL} | ${SITE_NAME}`;
		}
		if (pageIndex === backCoverPageIndex) {
			return `ספר ${seferName} - גב הספר | ${MASORA_MENU_LABEL} | ${SITE_NAME}`;
		}
		const unit =
			units[
				Math.floor((pageIndex - MASORA_CONTENT_OFFSET) / PAGES_PER_UNIT)
			];
		return unit ? masoraUnitDocumentTitle(unit.heading) : null;
	};
}

export { MASORA_ROOT_ALIASES };
