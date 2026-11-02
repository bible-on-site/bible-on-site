import { toLetters, toNumber } from "gematry";
import type { HistoryMapper, PageSemantics } from "html-flip-book-react";
import type { UnitBoundaryMarker } from "@/app/components/reading/UnitTextBody";
import bookPageSlugs from "@/data/book-page-slugs.json";
import divisionData from "@/data/parasha/parasha-division.json";
import {
	parashaCanonicalSlug,
	resolveParashaSegment,
} from "@/data/parasha/parasha-slugs";
import type { AuxiliaryReading, ScriptureRange } from "@/lib/reading/contract";
import { SITE_NAME } from "@/lib/seo/jsonld";

// The division root comes from the shared JSON so this module stays
// client-safe (the data module resolves the server-only corpus).
const PARASHA_ROOT = divisionData.rootPath;
const PARASHA_MENU_LABEL = divisionData.menuLabel;

/** Public Hebrew root + its ASCII route dir (popstate resolves both). */
export const PARASHA_ROOT_ALIASES = ["/פרשה", "/parasha"] as const;
export { PARASHA_ROOT };

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
	/** Canonical public slug — the unit URL's path segment (issue #2738). */
	slug: string;
	name: string;
	order: number;
	/** Scripture reference span of the primary range, formatted server-side. */
	refSpan: string;
	ranges: ScriptureRange[];
	/** Aliyah boundary markers for the unit's standalone Shabbat scheme
	 * (issue #2519): `"{perekId}:{pasuk}"` → marker specs, serialized
	 * server-side and rebuilt into the renderer's map client-side. */
	aliyahMarkers?: Record<
		string,
		readonly { key: string; label: string; role?: "aliyah" | "maftir" }[]
	>;
	/** The single marker key this unit's book spread shows. */
	aliyahMarkerKey?: string;
	haftarot: ParashaBookHaftara[];
	notes: string[];
}

export const PARASHA_CONTENT_OFFSET = 3;
const TOC_PAGE_INDEX = PARASHA_CONTENT_OFFSET - 1;
const TOC_SPREAD_INDEX = TOC_PAGE_INDEX - 1;
const FRONT_COVER_INDEX = 0;
/**
 * Pages one parasha contributes: Torah text + its commentary blank,
 * then Haftarah text + its commentary blank — each spread mirroring
 * the perek book's text/blank pairing so commentary stays bounded to
 * the reading it faces.
 */
const PAGES_PER_UNIT = 4;
const HAFTARA_TEXT_OFFSET = 2;

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
 * Torah page (named by its order numeral) and a Haftarah page, each
 * followed by a commentary blank that shares its route and stays out
 * of the TOC. Titles feed the table of contents — every parasha and
 * every Haftarah is directly reachable.
 */
export function buildParashaPageSemantics(
	units: ParashaBookUnit[],
): PageSemantics {
	return {
		indexToSemanticName(pageIndex: number): string {
			if (pageIndex < PARASHA_CONTENT_OFFSET) return "";
			const adjusted = pageIndex - PARASHA_CONTENT_OFFSET;
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
			return idx * PAGES_PER_UNIT + PARASHA_CONTENT_OFFSET;
		},
		indexToTitle(pageIndex: number): string {
			if (pageIndex < PARASHA_CONTENT_OFFSET) return "";
			const adjusted = pageIndex - PARASHA_CONTENT_OFFSET;
			const unitIdx = Math.floor(adjusted / PAGES_PER_UNIT);
			if (unitIdx >= units.length) return "";
			const unit = units[unitIdx];
			if (adjusted % PAGES_PER_UNIT === 0) return `פרשת ${unit.name}`;
			if (adjusted % PAGES_PER_UNIT === HAFTARA_TEXT_OFFSET) {
				return `הפטרת ${unit.name}`;
			}
			return "";
		},
	};
}

/**
 * URL <-> leaf mapping for the פרשה book. A parasha's Torah spread —
 * its text page and the facing commentary blank — shares
 * `/פרשה/{slug}?book`; the Haftarah spread shares
 * `/פרשה/{slug}?book&haftara`. Book chrome reuses the shared
 * cover/contents/back slugs under `/פרשה/{sefer}/{slug}?book`.
 */
export function buildParashaHistoryMapper(
	units: ParashaBookUnit[],
	seferName: string,
): HistoryMapper {
	const backCoverIndex = PARASHA_CONTENT_OFFSET + units.length * PAGES_PER_UNIT;
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
			const unitIdx = Math.floor(adjusted / PAGES_PER_UNIT);
			const unit = units[Math.min(unitIdx, units.length - 1)];
			return `${PARASHA_ROOT}/${unit.slug}?book${
				adjusted % PAGES_PER_UNIT >= HAFTARA_TEXT_OFFSET ? "&haftara" : ""
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
			const segments = decodeURIComponent(pathname)
				.split("/")
				.filter(Boolean);
			if (
				segments.length === 2 &&
				(segments[0] === "פרשה" || segments[0] === "parasha")
			) {
				const unitId = resolveParashaSegment(segments[1])?.unitId;
				const idx = units.findIndex((unit) => unit.unitId === unitId);
				if (idx >= 0) {
					return (
						idx * PAGES_PER_UNIT +
						PARASHA_CONTENT_OFFSET +
						(params.has("haftara") ? HAFTARA_TEXT_OFFSET : 0)
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
	const pageIndex =
		idx * PAGES_PER_UNIT +
		PARASHA_CONTENT_OFFSET +
		(haftara ? HAFTARA_TEXT_OFFSET : 0);
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

/**
 * Flat route to land on when the user leaves the פרשה book. While the
 * book is open the flipbook owns browser history — window.location
 * names the unit the user actually reached, which the router's stale
 * pathname cannot see. Book-chrome exits and paths without a unit id
 * fall back to the unit the book was opened from (the /929 reader's
 * behaviour).
 */
export function parashaBookExitPath(
	pathname: string,
	fallbackUnitId: number,
): string {
	if (parashaBookPageFromPath(pathname)) {
		return `${PARASHA_ROOT}/${parashaCanonicalSlug(fallbackUnitId)}`;
	}
	const segments = decodeURIComponent(pathname).split("/").filter(Boolean);
	const resolved =
		segments.length === 2 &&
		(segments[0] === "פרשה" || segments[0] === "parasha")
			? resolveParashaSegment(segments[1])
			: null;
	return resolved
		? `${PARASHA_ROOT}/${resolved.slug}`
		: `${PARASHA_ROOT}/${parashaCanonicalSlug(fallbackUnitId)}`;
}

/** Title of a flat parasha unit page, matching generateMetadata. */
export function parashaUnitDocumentTitle(name: string): string {
	return `פרשת ${name} | ${PARASHA_MENU_LABEL} | ${SITE_NAME}`;
}

/**
 * Rebuild the renderer's coord→markers map from a book unit's
 * serialized standalone-Shabbat marker layer (issue #2519); undefined
 * when the unit carries no markers.
 */
export function unitBoundaryMarkers(
	unit: ParashaBookUnit,
): ReadonlyMap<string, readonly UnitBoundaryMarker[]> | undefined {
	return unit.aliyahMarkers
		? new Map(Object.entries(unit.aliyahMarkers))
		: undefined;
}

/** Title of a parasha's Haftarah spread inside the book. */
export function parashaHaftaraDocumentTitle(name: string): string {
	return `הפטרת ${name} | ${PARASHA_MENU_LABEL} | ${SITE_NAME}`;
}

/** Title of a perush open inside the פרשה book. */
export function parashaPerushDocumentTitle(
	perushName: string,
	unitName: string,
	haftara: boolean,
): string {
	const reading = haftara ? `הפטרת ${unitName}` : `פרשת ${unitName}`;
	return `${perushName} על ${reading} | ${PARASHA_MENU_LABEL} | ${SITE_NAME}`;
}

/**
 * Resolve the committed book page index to a document title, agreeing
 * with the history mapping: the front cover names the sefer, the
 * contents spread names the TOC, the back cover is marked, and each
 * spread's commentary blank carries the same title as its text page
 * (they share one route). Returns null for indices outside the book.
 */
export function buildParashaDocumentTitleResolver(
	seferName: string,
	units: ParashaBookUnit[],
	backCoverPageIndex: number,
): (pageIndex: number) => string | null {
	return (pageIndex) => {
		if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
		if (pageIndex === FRONT_COVER_INDEX) {
			return `ספר ${seferName} | ${PARASHA_MENU_LABEL} | ${SITE_NAME}`;
		}
		if (pageIndex < PARASHA_CONTENT_OFFSET) {
			return `ספר ${seferName} - תוכן העניינים | ${PARASHA_MENU_LABEL} | ${SITE_NAME}`;
		}
		if (pageIndex === backCoverPageIndex) {
			return `ספר ${seferName} - גב הספר | ${PARASHA_MENU_LABEL} | ${SITE_NAME}`;
		}
		const adjusted = pageIndex - PARASHA_CONTENT_OFFSET;
		const unit = units[Math.floor(adjusted / PAGES_PER_UNIT)];
		if (!unit) return null;
		return adjusted % PAGES_PER_UNIT >= HAFTARA_TEXT_OFFSET
			? parashaHaftaraDocumentTitle(unit.name)
			: parashaUnitDocumentTitle(unit.name);
	};
}
