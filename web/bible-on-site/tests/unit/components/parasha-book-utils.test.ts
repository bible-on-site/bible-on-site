/**
 * @jest-environment node
 *
 * Page-semantics and history-mapper coverage for the פרשה sefer book:
 * each parasha contributes a Torah spread (text + commentary blank)
 * and a Haftarah spread (text + commentary blank). TOC titles cover
 * both text pages, blanks share their spread's route, and URL <->
 * leaf mapping spans unit routes and book-chrome cover/contents/back
 * paths.
 */
import {
	buildParashaDocumentTitleResolver,
	buildParashaHistoryMapper,
	buildParashaPageSemantics,
	computeParashaInitialTurnedLeaves,
	PARASHA_CONTENT_OFFSET,
	parashaBookPageFromPath,
	parashaBookPageFromQuery,
	parashaBookPageRoute,
	parashaHaftaraDocumentTitle,
	parashaPerushDocumentTitle,
	parashaUnitDocumentTitle,
	pathnameWithParashaBookQuery,
	type ParashaBookUnit,
} from "@/app/parasha/[unit]/components/parasha-book-utils";
import { SITE_NAME } from "@/lib/seo/jsonld";

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

	it("names Torah pages by parasha order; blanks and Haftarot unnamed", () => {
		expect(semantics.indexToSemanticName(0)).toBe("");
		expect(semantics.indexToSemanticName(2)).toBe("");
		expect(semantics.indexToSemanticName(3)).toBe("א");
		// Torah blank, Haftarah text, Haftarah blank — all unnamed.
		expect(semantics.indexToSemanticName(4)).toBe("");
		expect(semantics.indexToSemanticName(5)).toBe("");
		expect(semantics.indexToSemanticName(6)).toBe("");
		expect(semantics.indexToSemanticName(7)).toBe("ב");
		expect(semantics.indexToSemanticName(11)).toBe("ג");
		// A Torah page beyond the last unit is unnamed.
		expect(semantics.indexToSemanticName(15)).toBe("");
	});

	it("resolves semantic names back to Torah page indices", () => {
		expect(semantics.semanticNameToIndex("א")).toBe(3);
		expect(semantics.semanticNameToIndex("ג")).toBe(11);
		expect(semantics.semanticNameToIndex("ד")).toBeNull();
		expect(semantics.semanticNameToIndex("x")).toBeNull();
	});

	it("titles Torah and Haftarah text pages for the TOC, blanks untitled", () => {
		expect(semantics.indexToTitle(3)).toBe("פרשת בראשית");
		expect(semantics.indexToTitle(4)).toBe("");
		expect(semantics.indexToTitle(5)).toBe("הפטרת בראשית");
		expect(semantics.indexToTitle(6)).toBe("");
		expect(semantics.indexToTitle(7)).toBe("פרשת נח");
		expect(semantics.indexToTitle(9)).toBe("הפטרת נח");
		expect(semantics.indexToTitle(11)).toBe("פרשת לך לך");
		expect(semantics.indexToTitle(13)).toBe("הפטרת לך לך");
		expect(semantics.indexToTitle(0)).toBe("");
		expect(semantics.indexToTitle(99)).toBe("");
	});
});

describe("buildParashaHistoryMapper", () => {
	const units = makeUnits();
	const mapper = buildParashaHistoryMapper(units, "בראשית");
	const backCoverIndex = PARASHA_CONTENT_OFFSET + units.length * 4;

	it("maps chrome pages to book-chrome routes", () => {
		expect(mapper.pageToRoute(0, undefined)).toBe("/פרשה/בראשית/כריכה?book");
		expect(mapper.pageToRoute(1, undefined)).toBe("/פרשה/בראשית/תוכן?book");
		expect(mapper.pageToRoute(2, undefined)).toBe("/פרשה/בראשית/תוכן?book");
		expect(mapper.pageToRoute(backCoverIndex, undefined)).toBe(
			"/פרשה/בראשית/גב?book",
		);
	});

	it("maps spread pages to their shared unit routes", () => {
		// Torah text and its blank share the bare unit route; Haftarah
		// text and its blank share the &haftara route.
		expect(mapper.pageToRoute(3, undefined)).toBe("/פרשה/1?book");
		expect(mapper.pageToRoute(4, undefined)).toBe("/פרשה/1?book");
		expect(mapper.pageToRoute(5, undefined)).toBe("/פרשה/1?book&haftara");
		expect(mapper.pageToRoute(6, undefined)).toBe("/פרשה/1?book&haftara");
		expect(mapper.pageToRoute(7, undefined)).toBe("/פרשה/2?book");
		expect(mapper.pageToRoute(9, undefined)).toBe("/פרשה/2?book&haftara");
	});

	it("resolves unit routes back to their text pages", () => {
		expect(mapper.routeToPage("/פרשה/1?book")).toBe(3);
		expect(mapper.routeToPage("/פרשה/1?book&haftara")).toBe(5);
		expect(mapper.routeToPage("/פרשה/3?book")).toBe(11);
		expect(mapper.routeToPage("/פרשה/3?book&haftara=1")).toBe(13);
	});

	it("resolves book-chrome routes back to chrome pages", () => {
		expect(mapper.routeToPage("/פרשה/בראשית/כריכה?book")).toBe(0);
		expect(mapper.routeToPage("/פרשה/בראשית/תוכן?book")).toBe(1);
		expect(mapper.routeToPage("/פרשה/בראשית/גב?book")).toBe(backCoverIndex);
	});

	it("resolves percent-encoded unit routes", () => {
		expect(mapper.routeToPage(`/${encodeURIComponent("פרשה")}/2?book`)).toBe(7);
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

	it("turns leaves up to the requested Torah text page", () => {
		expect(computeParashaInitialTurnedLeaves(units, 1, false)).toEqual([0, 1]);
		// Unit 2's Torah text sits at page 7 — ceil(7/2) leaves.
		expect(computeParashaInitialTurnedLeaves(units, 2, false)).toEqual([
			0, 1, 2, 3,
		]);
	});

	it("includes the Haftarah text page when requested", () => {
		// The Haftarah text page (index 5 for unit 1) tops a different
		// spread than the Torah text page — the turned-leaf count matches
		// the /929 book's `ceil(pageIndex / 2)` convention.
		expect(computeParashaInitialTurnedLeaves(units, 1, true)).toEqual([
			0, 1, 2,
		]);
		expect(computeParashaInitialTurnedLeaves(units, 2, true)).toEqual([
			0, 1, 2, 3, 4,
		]);
	});

	it("returns undefined for a unit outside the sefer", () => {
		expect(computeParashaInitialTurnedLeaves(units, 99, false)).toBeUndefined();
	});
});

describe("parasha document titles", () => {
	it("formats unit, Haftarah, and perush titles like the flat page", () => {
		expect(parashaUnitDocumentTitle("נח")).toBe(
			`פרשת נח | פרשה על הפרק | ${SITE_NAME}`,
		);
		expect(parashaHaftaraDocumentTitle("נח")).toBe(
			`הפטרת נח | פרשה על הפרק | ${SITE_NAME}`,
		);
		expect(parashaPerushDocumentTitle('רש"י', "נח", false)).toBe(
			`רש"י על פרשת נח | פרשה על הפרק | ${SITE_NAME}`,
		);
		expect(parashaPerushDocumentTitle('רש"י', "נח", true)).toBe(
			`רש"י על הפטרת נח | פרשה על הפרק | ${SITE_NAME}`,
		);
	});
});

describe("buildParashaDocumentTitleResolver", () => {
	const units = makeUnits();
	const backCoverIndex = PARASHA_CONTENT_OFFSET + units.length * 4;
	const resolve = buildParashaDocumentTitleResolver(
		"בראשית",
		units,
		backCoverIndex,
	);

	it("names chrome pages and spreads to match the history mapping", () => {
		expect(resolve(0)).toBe(`ספר בראשית | פרשה על הפרק | ${SITE_NAME}`);
		expect(resolve(1)).toBe(
			`ספר בראשית - תוכן העניינים | פרשה על הפרק | ${SITE_NAME}`,
		);
		expect(resolve(2)).toBe(
			`ספר בראשית - תוכן העניינים | פרשה על הפרק | ${SITE_NAME}`,
		);
		expect(resolve(backCoverIndex)).toBe(
			`ספר בראשית - גב הספר | פרשה על הפרק | ${SITE_NAME}`,
		);
	});

	it("gives a spread's blank the same title as its text page", () => {
		expect(resolve(3)).toBe(`פרשת בראשית | פרשה על הפרק | ${SITE_NAME}`);
		expect(resolve(4)).toBe(`פרשת בראשית | פרשה על הפרק | ${SITE_NAME}`);
		expect(resolve(5)).toBe(`הפטרת בראשית | פרשה על הפרק | ${SITE_NAME}`);
		expect(resolve(6)).toBe(`הפטרת בראשית | פרשה על הפרק | ${SITE_NAME}`);
		expect(resolve(7)).toBe(`פרשת נח | פרשה על הפרק | ${SITE_NAME}`);
		expect(resolve(9)).toBe(`הפטרת נח | פרשה על הפרק | ${SITE_NAME}`);
	});

	it("returns null outside the book", () => {
		expect(resolve(-1)).toBeNull();
		expect(resolve(backCoverIndex + 1)).toBeNull();
		expect(resolve(1.5)).toBeNull();
	});
});
