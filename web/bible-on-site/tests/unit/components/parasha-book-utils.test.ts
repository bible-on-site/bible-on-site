/**
 * @jest-environment node
 *
 * Page-semantics and history-mapper coverage for the פרשה sefer book:
 * parasha Torah pages pair with Haftarah pages, TOC titles cover both
 * halves, and URL <-> leaf mapping spans unit routes and book-chrome
 * cover/contents/back paths.
 */
import {
	buildParashaHistoryMapper,
	buildParashaPageSemantics,
	computeParashaInitialTurnedLeaves,
	PARASHA_CONTENT_OFFSET,
	parashaBookPageFromPath,
	parashaBookPageFromQuery,
	parashaBookPageRoute,
	pathnameWithParashaBookQuery,
	type ParashaBookUnit,
} from "@/app/parasha/[unit]/components/parasha-book-utils";

function makeUnits(): ParashaBookUnit[] {
	return [
		{
			unitId: 1,
			name: "בראשית",
			order: 1,
			refSpan: "בראשית א א - ו ח",
			ranges: [],
			haftarot: [],
			notes: [],
		},
		{
			unitId: 2,
			name: "נח",
			order: 2,
			refSpan: "בראשית ו ט - יא לב",
			ranges: [],
			haftarot: [],
			notes: [],
		},
		{
			unitId: 3,
			name: "לך לך",
			order: 3,
			refSpan: "בראשית יב א - יז כז",
			ranges: [],
			haftarot: [],
			notes: [],
		},
	];
}

describe("parashaBookPageRoute / parashaBookPageFromQuery", () => {
	it("builds book-chrome routes under the sefer name", () => {
		expect(parashaBookPageRoute("בראשית", "front")).toBe(
			"/פרשה/בראשית/כריכה?book",
		);
		expect(parashaBookPageRoute("שמות", "toc")).toBe("/פרשה/שמות/תוכן?book");
		expect(parashaBookPageRoute("דברים", "back")).toBe("/פרשה/דברים/גב?book");
	});

	it("resolves bookPage query values by key or slug", () => {
		expect(parashaBookPageFromQuery("front")).toBe("front");
		expect(parashaBookPageFromQuery("כריכה")).toBe("front");
		expect(parashaBookPageFromQuery("תוכן")).toBe("toc");
		expect(parashaBookPageFromQuery("נח")).toBeNull();
		expect(parashaBookPageFromQuery(null)).toBeNull();
	});
});

describe("parashaBookPageFromPath", () => {
	it("resolves cover slugs under a parasha sefer path", () => {
		expect(parashaBookPageFromPath("/פרשה/בראשית/כריכה")).toBe("front");
		expect(parashaBookPageFromPath("/פרשה/שמות/תוכן")).toBe("toc");
		expect(parashaBookPageFromPath("/פרשה/דברים/גב")).toBe("back");
	});

	it("resolves percent-encoded paths", () => {
		expect(
			parashaBookPageFromPath(
				`/${encodeURIComponent("פרשה")}/${encodeURIComponent("בראשית")}/${encodeURIComponent("כריכה")}`,
			),
		).toBe("front");
	});

	it("resolves the English parasha root path", () => {
		expect(parashaBookPageFromPath("/parasha/בראשית/כריכה")).toBe("front");
		expect(parashaBookPageFromPath("/parasha/דברים/גב")).toBe("back");
	});

	it("rejects non-book and malformed paths", () => {
		expect(parashaBookPageFromPath("/פרשה/1")).toBeNull();
		expect(parashaBookPageFromPath("/929/5")).toBeNull();
		expect(parashaBookPageFromPath("/פרשה/בראשית")).toBeNull();
		expect(parashaBookPageFromPath("/פרשה")).toBeNull();
		// A three-segment path whose slug is not a book page.
		expect(parashaBookPageFromPath("/פרשה/בראשית/נח")).toBeNull();
	});
});

describe("buildParashaPageSemantics", () => {
	const semantics = buildParashaPageSemantics(makeUnits());

	it("names Torah pages by parasha order, Haftarah pages unnamed", () => {
		expect(semantics.indexToSemanticName(0)).toBe("");
		expect(semantics.indexToSemanticName(2)).toBe("");
		expect(semantics.indexToSemanticName(3)).toBe("א");
		expect(semantics.indexToSemanticName(4)).toBe("");
		expect(semantics.indexToSemanticName(5)).toBe("ב");
		expect(semantics.indexToSemanticName(7)).toBe("ג");
		// A Torah page beyond the last unit is unnamed.
		expect(semantics.indexToSemanticName(9)).toBe("");
	});

	it("resolves semantic names back to Torah page indices", () => {
		expect(semantics.semanticNameToIndex("א")).toBe(3);
		expect(semantics.semanticNameToIndex("ג")).toBe(7);
		expect(semantics.semanticNameToIndex("ד")).toBeNull();
		expect(semantics.semanticNameToIndex("x")).toBeNull();
	});

	it("titles both Torah and Haftarah pages for the TOC", () => {
		expect(semantics.indexToTitle(3)).toBe("פרשת בראשית");
		expect(semantics.indexToTitle(4)).toBe("הפטרת בראשית");
		expect(semantics.indexToTitle(5)).toBe("פרשת נח");
		expect(semantics.indexToTitle(6)).toBe("הפטרת נח");
		expect(semantics.indexToTitle(7)).toBe("פרשת לך לך");
		expect(semantics.indexToTitle(8)).toBe("הפטרת לך לך");
		expect(semantics.indexToTitle(0)).toBe("");
		expect(semantics.indexToTitle(99)).toBe("");
	});
});

describe("buildParashaHistoryMapper", () => {
	const units = makeUnits();
	const mapper = buildParashaHistoryMapper(units, "בראשית");
	const backCoverIndex = PARASHA_CONTENT_OFFSET + units.length * 2;

	it("maps chrome pages to book-chrome routes", () => {
		expect(mapper.pageToRoute(0, undefined)).toBe("/פרשה/בראשית/כריכה?book");
		expect(mapper.pageToRoute(1, undefined)).toBe("/פרשה/בראשית/תוכן?book");
		expect(mapper.pageToRoute(2, undefined)).toBe("/פרשה/בראשית/תוכן?book");
		expect(mapper.pageToRoute(backCoverIndex, undefined)).toBe(
			"/פרשה/בראשית/גב?book",
		);
	});

	it("maps Torah and Haftarah pages to unit routes", () => {
		expect(mapper.pageToRoute(3, undefined)).toBe("/פרשה/1?book");
		expect(mapper.pageToRoute(4, undefined)).toBe("/פרשה/1?book&haftara");
		expect(mapper.pageToRoute(5, undefined)).toBe("/פרשה/2?book");
		expect(mapper.pageToRoute(6, undefined)).toBe("/פרשה/2?book&haftara");
	});

	it("resolves unit routes back to page indices", () => {
		expect(mapper.routeToPage("/פרשה/1?book")).toBe(3);
		expect(mapper.routeToPage("/פרשה/1?book&haftara")).toBe(4);
		expect(mapper.routeToPage("/פרשה/3?book")).toBe(7);
		expect(mapper.routeToPage("/פרשה/3?book&haftara=1")).toBe(8);
	});

	it("resolves book-chrome routes back to chrome pages", () => {
		expect(mapper.routeToPage("/פרשה/בראשית/כריכה?book")).toBe(0);
		expect(mapper.routeToPage("/פרשה/בראשית/תוכן?book")).toBe(1);
		expect(mapper.routeToPage("/פרשה/בראשית/גב?book")).toBe(backCoverIndex);
	});

	it("resolves percent-encoded unit routes", () => {
		expect(mapper.routeToPage(`/${encodeURIComponent("פרשה")}/2?book`)).toBe(5);
	});

	it("rejects non-book and unknown routes", () => {
		expect(mapper.routeToPage("/פרשה/1")).toBeNull();
		expect(mapper.routeToPage("/פרשה/99?book")).toBeNull();
		expect(mapper.routeToPage("/929/5?book")).toBeNull();
	});

	it("maps an empty unit list to nothing", () => {
		const empty = buildParashaHistoryMapper([], "בראשית");
		expect(empty.pageToRoute(3, undefined)).toBeNull();
		expect(empty.routeToPage("/פרשה/1?book")).toBeNull();
	});

	it("rejects page indices before the content offset", () => {
		expect(mapper.pageToRoute(-1, undefined)).toBeNull();
	});
});

describe("pathnameWithParashaBookQuery", () => {
	it("adds ?book while preserving other params", () => {
		expect(pathnameWithParashaBookQuery("/פרשה/1", "haftara&x=1", true)).toBe(
			"/פרשה/1?haftara=&x=1&book=",
		);
	});

	it("accepts a leading question mark on the current query", () => {
		expect(pathnameWithParashaBookQuery("/פרשה/1", "?keep=1", true)).toBe(
			"/פרשה/1?keep=1&book=",
		);
	});

	it("strips every book param when leaving book view", () => {
		expect(
			pathnameWithParashaBookQuery(
				"/פרשה/1",
				"book&haftara&toc=1&bookPage=front&keep=2",
				false,
			),
		).toBe("/פרשה/1?keep=2");
	});

	it("returns the bare pathname when nothing remains", () => {
		expect(pathnameWithParashaBookQuery("/פרשה/1", "book", false)).toBe(
			"/פרשה/1",
		);
	});
});

describe("computeParashaInitialTurnedLeaves", () => {
	const units = makeUnits();

	it("turns leaves up to the requested Torah page", () => {
		expect(computeParashaInitialTurnedLeaves(units, 1, false)).toEqual([0, 1]);
		expect(computeParashaInitialTurnedLeaves(units, 2, false)).toEqual([
			0, 1, 2,
		]);
	});

	it("includes the Haftarah page when requested", () => {
		// The Haftarah page (index 4) tops a different spread than the
		// Torah page (index 3) — the turned-leaf count matches the /929
		// book's `ceil(pageIndex / 2)` convention.
		expect(computeParashaInitialTurnedLeaves(units, 1, true)).toEqual([0, 1]);
		expect(computeParashaInitialTurnedLeaves(units, 2, true)).toEqual([
			0, 1, 2,
		]);
	});

	it("returns undefined for a unit outside the sefer", () => {
		expect(computeParashaInitialTurnedLeaves(units, 99, false)).toBeUndefined();
	});
});
