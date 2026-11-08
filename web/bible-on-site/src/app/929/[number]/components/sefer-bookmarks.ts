import type { Bookmark } from "html-flip-book-react";
import type { SefarimItem } from "@/data/db/tanah-view-types";
import { CONTENT_OFFSET, toHebrewChapterNumber } from "./sefer-page-utils";

/**
 * Chapter-tab payload carried in `Bookmark.data`. Compact tabs show only the
 * chapter reference; expanded/hover state shows that reference and the perek
 * title. Accessible labels keep the full canonical source (שמואל ב ה).
 */
export type SeferBookmarkData = {
	/** Compact tab text: chapter letter(s), plus the additional's letter for
	 * split sefarim (e.g. "ב ג" for שמואל ב פרק ג) so identical chapter
	 * letters across parts stay distinguishable. */
	compact: string;
	/** Canonical full source ("שמואל ב ה"). */
	source: string;
	/** Optional perek title/header text. */
	title?: string;
};

export type SeferChapterBookmark = Bookmark & { data: SeferBookmarkData };

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
		additionalLetter?: string;
		perakimCount: number;
		headers: (string | undefined)[];
	}[] =
		"perakim" in sefer
			? [
					{
						perakimCount: sefer.perakim.length,
						headers: sefer.perakim.map((p) => p.header),
					},
				]
			: sefer.additionals.map((additional) => ({
					additionalLetter: additional.letter,
					perakimCount: additional.perakim.length,
					headers: additional.perakim.map((p) => p.header),
				}));

	const bookmarks: SeferChapterBookmark[] = [];
	let perekIdx = 0;
	for (const { additionalLetter, perakimCount, headers } of units) {
		for (let i = 0; i < perakimCount; i++, perekIdx++) {
			const perekHeb = toHebrewChapterNumber(i + 1);
			const title = headers[i];
			const compact = additionalLetter
				? `${additionalLetter} ${perekHeb}`
				: perekHeb;
			const source = `${sefer.name} ${compact}`;
			bookmarks.push({
				id: `perek-${perekIds?.[perekIdx] ?? `idx-${perekIdx}`}`,
				pageIndex: CONTENT_OFFSET + perekIdx * 2,
				label: title ? `${source} - ${title}` : source,
				data: {
					compact,
					source,
					...(title ? { title } : {}),
				},
			});
		}
	}
	return bookmarks;
}
