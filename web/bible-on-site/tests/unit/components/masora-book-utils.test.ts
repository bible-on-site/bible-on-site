/**
 * @jest-environment node
 *
 * Page-semantics and history-mapper coverage for the מסורה sefer book:
 * each Masoretic unit contributes a text page followed by a commentary
 * blank that shares its route. TOC titles name every parasha, URL <->
 * leaf mapping spans unit routes and the numeric book-chrome paths,
 * and the first-unit-per-sefer contract the chrome routes rely on
 * stays pinned against the real division data.
 */
import {
	buildMasoraDocumentTitleResolver,
	buildMasoraHistoryMapper,
	buildMasoraPageSemantics,
	computeMasoraInitialTurnedLeaves,
	MASORA_CONTENT_OFFSET,
	MASORA_ROOT,
	type MasoraBookUnit,
	masoraBookExitPath,
	masoraBookPageFromPath,
	masoraBookPageFromQuery,
	masoraBookPageRoute,
	masoraPerushDocumentTitle,
	masoraUnitDocumentTitle,
	pathnameWithMasoraBookQuery,
} from "@/app/masora/[unit]/components/masora-book-utils";
import {
	getMasoraFirstUnitBySefer,
	getMasoraUnitsForSefer,
} from "@/data/masora/masora-units";
import { sefarim } from "@/data/db/sefarim";
import { SITE_NAME } from "@/lib/seo/jsonld";

function makeUnits(): MasoraBookUnit[] {
	return [
		{
			unitId: 1,
			order: 1,
			heading: "בראשית א א-ה",
			ranges: [],
			closingBreak: "ptuha",
		},
		{
			unitId: 2,
			order: 2,
			heading: "בראשית א ו-כט",
			ranges: [],
			closingBreak: "stuma",
		},
		{
			unitId: 3,
			order: 3,
			heading: "בראשית א ל - ב ג",
			ranges: [],
			closingBreak: null,
		},
	];
}

describe("masora first-unit-per-sefer parity", () => {
	it("numbers each sefer's first unit sequentially over the corpus", () => {
		// The book-chrome routes land on a sefer's first unit id; this
		// pins the contract the rewrite relies on: first units follow
		// the derivation order (markers + one closing unit per sefer).
		const first = getMasoraFirstUnitBySefer();
		expect(first.map((unit) => unit.seferName)).toEqual(
			sefarim.map((sefer) => sefer.name),
		);
		expect(first[0].unitId).toBe(1);
		for (const unit of first) {
			const seferUnits = getMasoraUnitsForSefer(unit.seferName);
			expect(unit.unitId).toBe(seferUnits[0].unitId);
			expect(unit.order).toBe(1);
		}
	});
});

describe("masoraBookPageRoute / masoraBookPageFromQuery", () => {
	it("builds book-chrome routes under the sefer's first unit id", () => {
		expect(masoraBookPageRoute(1, "front")).toBe("/מסורה/1/כריכה?book");
		expect(masoraBookPageRoute(137, "toc")).toBe(
			"/מסורה/137/תוכן?book",
		);
		expect(masoraBookPageRoute(42, "back")).toBe("/מסורה/42/גב?book");
	});

	it("resolves bookPage query values by key or slug", () => {
		expect(masoraBookPageFromQuery("front")).toBe("front");
		expect(masoraBookPageFromQuery("כריכה")).toBe("front");
		expect(masoraBookPageFromQuery("תוכן")).toBe("toc");
		expect(masoraBookPageFromQuery("בראשית")).toBeNull();
		expect(masoraBookPageFromQuery(null)).toBeNull();
	});
});

describe("masoraBookPageFromPath", () => {
	it("resolves chrome slugs under a numeric unit path", () => {
		expect(masoraBookPageFromPath("/מסורה/1/כריכה")).toBe("front");
		expect(masoraBookPageFromPath("/מסורה/137/תוכן")).toBe("toc");
		expect(masoraBookPageFromPath("/מסורה/42/גב")).toBe("back");
	});

	it("resolves percent-encoded paths and the ASCII route dir", () => {
		expect(
			masoraBookPageFromPath(
				`/${encodeURIComponent("מסורה")}/5/${encodeURIComponent("כריכה")}`,
			),
		).toBe("front");
		expect(masoraBookPageFromPath("/masora/5/גב")).toBe("back");
	});

	it("rejects non-book, non-numeric, and malformed paths", () => {
		expect(masoraBookPageFromPath("/מסורה/1")).toBeNull();
		expect(masoraBookPageFromPath("/929/5")).toBeNull();
		expect(masoraBookPageFromPath("/מסורה/בראשית/כריכה")).toBeNull();
		expect(masoraBookPageFromPath("/מסורה")).toBeNull();
		expect(masoraBookPageFromPath("/מסורה/1/נח")).toBeNull();
	});
});

describe("buildMasoraPageSemantics", () => {
	const semantics = buildMasoraPageSemantics(makeUnits());

	it("names text pages by unit order; blanks stay unnamed", () => {
		expect(semantics.indexToSemanticName(0)).toBe("");
		expect(semantics.indexToSemanticName(2)).toBe("");
		expect(semantics.indexToSemanticName(3)).toBe("א");
		expect(semantics.indexToSemanticName(4)).toBe("");
		expect(semantics.indexToSemanticName(5)).toBe("ב");
		expect(semantics.indexToSemanticName(7)).toBe("ג");
		expect(semantics.indexToSemanticName(9)).toBe("");
	});

	it("resolves semantic names back to text page indices", () => {
		expect(semantics.semanticNameToIndex("א")).toBe(3);
		expect(semantics.semanticNameToIndex("ג")).toBe(7);
		expect(semantics.semanticNameToIndex("ד")).toBeNull();
		expect(semantics.semanticNameToIndex("x")).toBeNull();
	});

	it("titles every unit's text page for the TOC, blanks untitled", () => {
		expect(semantics.indexToTitle(3)).toBe("בראשית א א-ה");
		expect(semantics.indexToTitle(4)).toBe("");
		expect(semantics.indexToTitle(5)).toBe("בראשית א ו-כט");
		expect(semantics.indexToTitle(7)).toBe("בראשית א ל - ב ג");
		expect(semantics.indexToTitle(0)).toBe("");
		expect(semantics.indexToTitle(99)).toBe("");
	});
});

describe("buildMasoraHistoryMapper", () => {
	const units = makeUnits();
	const mapper = buildMasoraHistoryMapper(units);
	const backCoverIndex = MASORA_CONTENT_OFFSET + units.length * 2;

	it("maps chrome pages to first-unit book-chrome routes", () => {
		expect(mapper.pageToRoute(0, undefined)).toBe("/מסורה/1/כריכה?book");
		expect(mapper.pageToRoute(1, undefined)).toBe(
			"/מסורה/1/תוכן?book",
		);
		expect(mapper.pageToRoute(2, undefined)).toBe(
			"/מסורה/1/תוכן?book",
		);
		expect(mapper.pageToRoute(backCoverIndex, undefined)).toBe(
			"/מסורה/1/גב?book",
		);
	});

	it("maps a unit's text page and blank to the same unit route", () => {
		expect(mapper.pageToRoute(3, undefined)).toBe("/מסורה/1?book");
		expect(mapper.pageToRoute(4, undefined)).toBe("/מסורה/1?book");
		expect(mapper.pageToRoute(5, undefined)).toBe("/מסורה/2?book");
		expect(mapper.pageToRoute(6, undefined)).toBe("/מסורה/2?book");
	});

	it("resolves unit routes back to their text pages", () => {
		expect(mapper.routeToPage("/מסורה/1?book")).toBe(3);
		expect(mapper.routeToPage("/מסורה/3?book")).toBe(7);
		expect(mapper.routeToPage("/מסורה/3?book&perush=x")).toBe(7);
	});

	it("resolves book-chrome routes back to chrome pages", () => {
		expect(mapper.routeToPage("/מסורה/1/כריכה?book")).toBe(0);
		expect(mapper.routeToPage("/מסורה/1/תוכן?book")).toBe(1);
		expect(mapper.routeToPage("/מסורה/1/גב?book")).toBe(
			backCoverIndex,
		);
	});

	it("resolves percent-encoded unit routes and the ASCII route dir", () => {
		expect(mapper.routeToPage(`/${encodeURIComponent("מסורה")}/2?book`)).toBe(
			5,
		);
		expect(mapper.routeToPage("/masora/2?book")).toBe(5);
	});

	it("rejects non-book and unknown routes", () => {
		expect(mapper.routeToPage("/מסורה/1")).toBeNull();
		expect(mapper.routeToPage("/מסורה/99?book")).toBeNull();
		expect(mapper.routeToPage("/929/5?book")).toBeNull();
		expect(mapper.routeToPage("/פרשה/1?book")).toBeNull();
	});

	it("maps an empty unit list to nothing", () => {
		const empty = buildMasoraHistoryMapper([]);
		expect(empty.pageToRoute(3, undefined)).toBeNull();
		expect(empty.routeToPage("/מסורה/1?book")).toBeNull();
	});
});

describe("pathnameWithMasoraBookQuery", () => {
	it("adds ?book while preserving other params", () => {
		expect(pathnameWithMasoraBookQuery("/מסורה/1", "perush=x&y=1", true)).toBe(
			"/מסורה/1?perush=x&y=1&book=",
		);
	});

	it("strips book chrome params when leaving book view", () => {
		expect(
			pathnameWithMasoraBookQuery(
				"/מסורה/1",
				"book&toc=1&bookPage=front&keep=2",
				false,
			),
		).toBe("/מסורה/1?keep=2");
	});
});

describe("masoraBookExitPath", () => {
	it("returns the unit the flipbook's history wrote to the location", () => {
		// The router's pathname stays on the entry unit; the live
		// location names the unit the user flipped to.
		expect(masoraBookExitPath("/מסורה/8", 1)).toBe("/מסורה/8");
		expect(masoraBookExitPath("/masora/8", 1)).toBe("/מסורה/8");
		expect(
			masoraBookExitPath(
				"/%D7%9E%D7%A1%D7%95%D7%A8%D7%94/8",
				1,
			),
		).toBe("/מסורה/8");
	});

	it("falls back to the entry unit on book-chrome exits", () => {
		expect(masoraBookExitPath("/מסורה/1/כריכה", 5)).toBe("/מסורה/5");
		expect(masoraBookExitPath("/מסורה/1/תוכן", 5)).toBe("/מסורה/5");
		expect(masoraBookExitPath("/מסורה/1/גב", 5)).toBe("/מסורה/5");
	});

	it("falls back to the entry unit on non-unit paths", () => {
		expect(masoraBookExitPath("/מסורה", 3)).toBe("/מסורה/3");
		expect(masoraBookExitPath("/929/12", 3)).toBe("/מסורה/3");
	});
});

describe("computeMasoraInitialTurnedLeaves", () => {
	const units = makeUnits();

	it("turns leaves up to the requested unit's text page", () => {
		expect(computeMasoraInitialTurnedLeaves(units, 1)).toEqual([0, 1]);
		// Unit 2's text page sits at index 5 → ceil(5 / 2) leaves.
		expect(computeMasoraInitialTurnedLeaves(units, 2)).toEqual([0, 1, 2]);
	});

	it("returns undefined for a unit outside the sefer", () => {
		expect(computeMasoraInitialTurnedLeaves(units, 99)).toBeUndefined();
	});
});

describe("masora document titles", () => {
	it("formats unit and perush titles like the flat page", () => {
		expect(masoraUnitDocumentTitle("בראשית א א-ה")).toBe(
			`בראשית א א-ה | מסורה על הפרק | ${SITE_NAME}`,
		);
		expect(masoraPerushDocumentTitle('רש"י', "בראשית א א-ה")).toBe(
			`רש"י על בראשית א א-ה | מסורה על הפרק | ${SITE_NAME}`,
		);
	});
});

describe("buildMasoraDocumentTitleResolver", () => {
	const units = makeUnits();
	const backCoverIndex = MASORA_CONTENT_OFFSET + units.length * 2;
	const resolve = buildMasoraDocumentTitleResolver(
		"בראשית",
		units,
		backCoverIndex,
	);

	it("names chrome pages and unit spreads to match the history mapping", () => {
		expect(resolve(0)).toBe(`ספר בראשית | מסורה על הפרק | ${SITE_NAME}`);
		expect(resolve(1)).toBe(
			`ספר בראשית - תוכן העניינים | מסורה על הפרק | ${SITE_NAME}`,
		);
		expect(resolve(backCoverIndex)).toBe(
			`ספר בראשית - גב הספר | מסורה על הפרק | ${SITE_NAME}`,
		);
	});

	it("gives a blank the same title as its unit's text page", () => {
		expect(resolve(3)).toBe(`בראשית א א-ה | מסורה על הפרק | ${SITE_NAME}`);
		expect(resolve(4)).toBe(`בראשית א א-ה | מסורה על הפרק | ${SITE_NAME}`);
		expect(resolve(5)).toBe(`בראשית א ו-כט | מסורה על הפרק | ${SITE_NAME}`);
	});

	it("returns null outside the book", () => {
		expect(resolve(-1)).toBeNull();
		expect(resolve(backCoverIndex + 1)).toBeNull();
		expect(resolve(1.5)).toBeNull();
	});
});

describe("MASORA_ROOT", () => {
	it("stays the public Hebrew root the rewrite serves", () => {
		expect(MASORA_ROOT).toBe("/מסורה");
	});
});
