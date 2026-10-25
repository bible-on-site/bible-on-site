import type { Bookmark, BookmarkContext } from "html-flip-book-react";
import type { SefarimItem } from "@/data/db/tanah-view-types";
import { CONTENT_OFFSET, toHebrewChapterNumber } from "./sefer-page-utils";

/**
 * Chapter-tab payload carried in `Bookmark.data`. Compact tabs show only the
 * letters; expanded/hover state shows the perek title, "פרק X" and source
 * context. Labels keep canonical book/additional naming (שמואל ב ה).
 */
export type SeferBookmarkData = {
	/** Compact tab text: chapter letter(s), plus the additional's letter for
	 * split sefarim (e.g. "ב ג" for שמואל ב פרק ג) so identical chapter
	 * letters across parts stay distinguishable. */
	compact: string;
	/** Chapter Hebrew letter(s) for the expanded "פרק X" line. */
	perekHeb: string;
	/** Sefer + additional source context ("שמואל ב"; just the sefer name when
	 * the sefer is not split). */
	unitSource: string;
	/** Canonical full source ("שמואל ב ה"). */
	source: string;
	/** Optional perek title/header text. */
	title?: string;
};

export type SeferChapterBookmark = Bookmark & { data: SeferBookmarkData };

type BookmarkUnit = { source: string; additionalLetter?: string };

/**
 * One chapter tab per perek of the loaded sefer, targeting its text page.
 * Pages alternate [perek text, blank panel] after CONTENT_OFFSET, so perek i
 * lands on CONTENT_OFFSET + i*2 — canonical page indices that stay correct
 * even as covers/TOC stay fixed. ids key off perekIds (unique per perek)
 * rather than positional letters, which repeat across additionals.
 */
export function buildSeferChapterBookmarks(
	sefer: SefarimItem,
	perekIds: number[] | undefined,
): SeferChapterBookmark[] {
	const units: {
		unit: BookmarkUnit;
		perakimCount: number;
		headers: (string | undefined)[];
	}[] =
		"perakim" in sefer
			? [
					{
						unit: { source: sefer.name },
						perakimCount: sefer.perakim.length,
						headers: sefer.perakim.map((p) => p.header),
					},
				]
			: sefer.additionals.map((additional) => ({
					unit: {
						source: `${sefer.name} ${additional.letter}`,
						additionalLetter: additional.letter,
					},
					perakimCount: additional.perakim.length,
					headers: additional.perakim.map((p) => p.header),
				}));

	const bookmarks: SeferChapterBookmark[] = [];
	let perekIdx = 0;
	for (const { unit, perakimCount, headers } of units) {
		for (let i = 0; i < perakimCount; i++, perekIdx++) {
			const perekHeb = toHebrewChapterNumber(i + 1);
			const title = headers[i];
			const source = `${unit.source} ${perekHeb}`;
			bookmarks.push({
				id: `perek-${perekIds?.[perekIdx] ?? `idx-${perekIdx}`}`,
				pageIndex: CONTENT_OFFSET + perekIdx * 2,
				label: title ? `${source} - ${title}` : source,
				data: {
					compact: unit.additionalLetter
						? `${unit.additionalLetter} ${perekHeb}`
						: perekHeb,
					perekHeb,
					unitSource: unit.source,
					source,
					...(title ? { title } : {}),
				},
			});
		}
	}
	return bookmarks;
}

const heCollator = new Intl.Collator("he");

/**
 * Hebrew-aware comparator for the "by title" ordering preference — compares
 * the perek title when present, falling back to the canonical label. Typed
 * on the base Bookmark so it slots straight into the provider's order field.
 */
export const compareSeferBookmarkTitles = (
	a: Bookmark,
	b: Bookmark,
): number => {
	const title = (bookmark: Bookmark) =>
		(bookmark.data as SeferBookmarkData | undefined)?.title ?? bookmark.label;
	return heCollator.compare(title(a), title(b));
};

/**
 * "Upcoming chapters only" preference: keep tabs whose target page is at or
 * after the current position. Disabled (the default) keeps past, current and
 * future chapters all reachable.
 */
export function filterUpcomingBookmarks(
	bookmarks: readonly SeferChapterBookmark[],
	context: BookmarkContext,
	upcomingOnly: boolean,
): readonly SeferChapterBookmark[] {
	if (!upcomingOnly) return bookmarks;
	return bookmarks.filter((b) => b.pageIndex >= context.currentPageIndex);
}
