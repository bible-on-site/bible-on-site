import {
	buildSeferChapterBookmarks,
	compareSeferBookmarkTitles,
	filterUpcomingBookmarks,
	type SeferBookmarkData,
} from "@/app/929/[number]/components/sefer-bookmarks";
import { CONTENT_OFFSET } from "@/app/929/[number]/components/sefer-page-utils";
import type { Perek, SefarimItem } from "@/data/db/tanah-view-types";

const perek = (header?: string): Perek =>
	({ header, pesukim: [] }) as unknown as Perek;

const simpleSefer = (name: string, headers: (string | undefined)[]) =>
	({
		name,
		helek: "תורה",
		tanachUsName: name,
		pesukimCount: 0,
		perekFrom: 1,
		perekTo: headers.length,
		perakim: headers.map(perek),
	}) as SefarimItem;

const splitSefer = (
	name: string,
	alef: (string | undefined)[],
	bet: (string | undefined)[],
) =>
	({
		name,
		helek: "נביאים",
		pesukimCount: 0,
		perekFrom: 1,
		perekTo: alef.length + bet.length,
		additionals: [
			{
				helek: "נביאים",
				letter: "א",
				name: `${name} א`,
				tanachUsName: `${name} alef`,
				pesukimCount: 0,
				perekFrom: 1,
				perekTo: alef.length,
				perakim: alef.map(perek),
			},
			{
				helek: "נביאים",
				letter: "ב",
				name: `${name} ב`,
				tanachUsName: `${name} bet`,
				pesukimCount: 0,
				perekFrom: alef.length + 1,
				perekTo: alef.length + bet.length,
				perakim: bet.map(perek),
			},
		],
	}) as unknown as SefarimItem;

describe("buildSeferChapterBookmarks", () => {
	it("maps every perek to its text page: covers/TOC take CONTENT_OFFSET, blank panels take the odd pages", () => {
		const sefer = simpleSefer("בראשית", ["אחרי הדברים", "ויהי", undefined]);
		const bookmarks = buildSeferChapterBookmarks(sefer, [10, 11, 12]);

		expect(bookmarks).toHaveLength(3);
		expect(bookmarks.map((b) => b.pageIndex)).toEqual([
			CONTENT_OFFSET,
			CONTENT_OFFSET + 2,
			CONTENT_OFFSET + 4,
		]);
		expect(bookmarks.map((b) => b.id)).toEqual([
			"perek-10",
			"perek-11",
			"perek-12",
		]);
	});

	it("labels tabs with the canonical source and carries chapter/title data", () => {
		const sefer = simpleSefer("בראשית", ["אחרי הדברים", undefined]);
		const [first, second] = buildSeferChapterBookmarks(sefer, [1, 2]);

		expect(first.label).toBe("בראשית א - אחרי הדברים");
		expect(second.label).toBe("בראשית ב");
		expect(first.data).toEqual<SeferBookmarkData>({
			compact: "א",
			perekHeb: "א",
			unitSource: "בראשית",
			source: "בראשית א",
			title: "אחרי הדברים",
		});
		expect(second.data.title).toBeUndefined();
		expect(second.data.compact).toBe("ב");
	});

	it("keeps identical chapter letters distinguishable across additionals", () => {
		const sefer = splitSefer("שמואל", ["title-a1", "title-a2"], ["title-b1"]);
		const bookmarks = buildSeferChapterBookmarks(sefer, [100, 101, 102]);

		expect(bookmarks).toHaveLength(3);
		expect(bookmarks.map((b) => b.data.compact)).toEqual(["א א", "א ב", "ב א"]);
		expect(bookmarks.map((b) => b.data.unitSource)).toEqual([
			"שמואל א",
			"שמואל א",
			"שמואל ב",
		]);
		expect(bookmarks[2].data.source).toBe("שמואל ב א");
		// pageIndex flows through the flattened perakim order, so שמואל ב פרק א
		// still lands on its own text page after שמואל א's chapters.
		expect(bookmarks.map((b) => b.pageIndex)).toEqual([
			CONTENT_OFFSET,
			CONTENT_OFFSET + 2,
			CONTENT_OFFSET + 4,
		]);
	});

	it("produces unique ids even without perekIds", () => {
		const sefer = splitSefer("עזרא", [undefined], [undefined, undefined]);
		const bookmarks = buildSeferChapterBookmarks(sefer, undefined);
		expect(new Set(bookmarks.map((b) => b.id)).size).toBe(3);
	});

	it("scales to long books like תהילים without gaps", () => {
		const sefer = simpleSefer(
			"תהילים",
			Array.from({ length: 150 }, () => undefined),
		);
		const bookmarks = buildSeferChapterBookmarks(sefer, undefined);
		expect(bookmarks).toHaveLength(150);
		expect(bookmarks[149].pageIndex).toBe(CONTENT_OFFSET + 149 * 2);
		expect(bookmarks[149].data.compact).toBe("קנ");
	});
});

describe("filterUpcomingBookmarks", () => {
	const sefer = simpleSefer("בראשית", ["h1", "h2", "h3"]);
	const bookmarks = buildSeferChapterBookmarks(sefer, [1, 2, 3]);
	const context = {
		currentPageIndex: CONTENT_OFFSET + 2,
		currentLeafIndex: 2,
		direction: "rtl" as const,
	};

	it("returns all bookmarks when upcomingOnly is off (past, current, future)", () => {
		expect(filterUpcomingBookmarks(bookmarks, context, false)).toBe(bookmarks);
	});

	it("keeps only tabs at or after the current page when upcomingOnly is on", () => {
		const filtered = filterUpcomingBookmarks(bookmarks, context, true);
		expect(filtered.map((b) => b.pageIndex)).toEqual([
			CONTENT_OFFSET + 2,
			CONTENT_OFFSET + 4,
		]);
	});
});

describe("compareSeferBookmarkTitles", () => {
	const sefer = simpleSefer("בראשית", ["ויבא", "אחרי הדברים", undefined]);
	const [vayavo, acharei, untitled] = buildSeferChapterBookmarks(
		sefer,
		[1, 2, 3],
	);

	it("orders by perek title in Hebrew collation, with the canonical label as fallback", () => {
		// אחרי < בראשית ג (fallback label) < ויבא — the untitled perek's
		// canonical label collates between the two titled ones.
		expect(
			[vayavo, acharei, untitled]
				.sort(compareSeferBookmarkTitles)
				.map((b) => b.data.title),
		).toEqual(["אחרי הדברים", undefined, "ויבא"]);
	});

	it("falls back to the canonical label for untitled perakim", () => {
		expect(compareSeferBookmarkTitles(untitled, acharei)).toBeGreaterThan(0);
	});
});
