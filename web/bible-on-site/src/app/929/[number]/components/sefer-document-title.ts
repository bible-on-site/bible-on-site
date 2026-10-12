import { toLetters } from "gematry";
import type { SefarimItem } from "@/data/db/tanah-view-types";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { CONTENT_OFFSET } from "./sefer-page-utils";

/**
 * Document-title synchronization for the Sefer (flipbook) reader (#2176).
 *
 * The flipbook owns *when* the active page changes — Sefer hooks the committed
 * page through the library's `onPageFlipped` contract (the same moment history
 * is synchronized) and calls the resolver below with the current page index.
 * This module supplies the *what*: the site's title format and book semantics,
 * aligned with `buildHistoryMapper` so the visible page, URL, and tab title
 * always describe the same location.
 */

/** Title-parts for one perek spread, in flattened perakim order. */
export interface SeferPerekTitle {
	/** Qualified source matching `PerekObj.source`, e.g. "בראשית א" or "שמואל ב ג". */
	source: string;
	/** Base sefer name used by the standalone perush page title ("שמואל"). */
	seferName: string;
	/** Local perek numeral within its sefer part, e.g. "א" for שמואל ב perek 1. */
	perekHeb: string;
}

/**
 * Build per-perek title parts from a loaded sefer. Sefarim split into
 * additionals (e.g. שמואל א/ב, עזרא/נחמיה) restart their perek numbering per
 * part, so the source mirrors `PerekObj.source`: the sefer name plus the
 * additional's letter — "עזרא נ א", not the additional's own name.
 */
export function buildSeferPerekTitles(sefer: SefarimItem): SeferPerekTitle[] {
	const units =
		"perakim" in sefer
			? [{ source: sefer.name, perakim: sefer.perakim }]
			: sefer.additionals.map((additional) => ({
					source: `${sefer.name} ${additional.letter}`,
					perakim: additional.perakim,
				}));
	return units.flatMap((unit) =>
		unit.perakim.map((_, perekIdx) => {
			const perekHeb = toLetters(perekIdx + 1);
			return {
				source: `${unit.source} ${perekHeb}`,
				seferName: sefer.name,
				perekHeb,
			};
		}),
	);
}

/** Title of a flat perek page, matching its `generateMetadata` output. */
export function perekDocumentTitle(source: string): string {
	return `${source} | ${SITE_NAME}`;
}

/** Title of an article, matching the standalone article page. */
export function articleDocumentTitle(article: {
	name: string;
	authorName: string;
}): string {
	return `${article.name} | ${article.authorName} | ${SITE_NAME}`;
}

/** Title of a perush on a perek, matching the standalone perush page. */
export function perushDocumentTitle(
	perush: { name: string },
	perek: SeferPerekTitle,
): string {
	return `${perush.name} על ${perek.seferName} ${perek.perekHeb} | ${SITE_NAME}`;
}

/**
 * Resolve the committed book page index to a document title, agreeing with the
 * history mapping: the front cover names the sefer, the contents spread names
 * the TOC, the back cover is marked, and companion/blank pages carry the same
 * perek title as their content page (they share one route). Returns null for
 * indices outside the book so a stale callback leaves the title untouched.
 */
export function buildSeferDocumentTitleResolver(
	seferName: string,
	pereks: SeferPerekTitle[],
	backCoverPageIndex: number,
): (pageIndex: number) => string | null {
	return (pageIndex) => {
		if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
		if (pageIndex === 0) return `ספר ${seferName} | ${SITE_NAME}`;
		if (pageIndex < CONTENT_OFFSET) {
			return `ספר ${seferName} - תוכן העניינים | ${SITE_NAME}`;
		}
		if (pageIndex === backCoverPageIndex) {
			return `ספר ${seferName} - גב הספר | ${SITE_NAME}`;
		}
		const perek = pereks[Math.floor((pageIndex - CONTENT_OFFSET) / 2)];
		return perek ? perekDocumentTitle(perek.source) : null;
	};
}

/**
 * Title ownership: the last title written on the reader's behalf. A stale
 * book update must never overwrite a title another page already owns (e.g.
 * after a router navigation set a new title before the reader unmounted).
 */
let seferOwnedTitle: string | null = null;

/** Write the document title on behalf of the Sefer reader. */
export function setSeferDocumentTitle(title: string): void {
	seferOwnedTitle = title;
	document.title = title;
}

/**
 * Release the reader's title ownership, restoring `fallbackTitle` only when
 * the reader still owns the title; otherwise leave the newer title alone.
 */
export function releaseSeferDocumentTitle(fallbackTitle: string): void {
	if (seferOwnedTitle !== null && document.title === seferOwnedTitle) {
		document.title = fallbackTitle;
	}
	seferOwnedTitle = null;
}
