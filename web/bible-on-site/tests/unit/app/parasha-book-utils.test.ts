/**
 * Tests for the parasha book helpers: history mapping, exit paths,
 * document titles, and the serialized-boundary-marker rebuild (issue
 * #2519).
 */
import {
	PARASHA_CONTENT_OFFSET,
	PARASHA_ROOT,
	type ParashaBookUnit,
	buildParashaHistoryMapper,
	parashaBookExitPath,
	parashaPerushDocumentTitle,
	parashaUnitDocumentTitle,
	unitBoundaryMarkers,
} from "../../../src/app/parasha/[unit]/components/parasha-book-utils";

const UNIT: ParashaBookUnit = {
	unitId: 42,
	slug: "מטות",
	name: "מטות",
	order: 42,
	refSpan: "במדבר ל-לב",
	ranges: [],
	haftarot: [],
	notes: [],
};

describe("buildParashaHistoryMapper", () => {
	const mapper = buildParashaHistoryMapper([UNIT], "במדבר");

	it("maps chrome pages to their routes", () => {
		expect(mapper.pageToRoute(0, undefined)).toBe(
			`${PARASHA_ROOT}/במדבר/כריכה?book`,
		);
		expect(mapper.pageToRoute(1, undefined)).toBe(
			`${PARASHA_ROOT}/במדבר/תוכן?book`,
		);
		expect(mapper.pageToRoute(2, undefined)).toBe(
			`${PARASHA_ROOT}/במדבר/תוכן?book`,
		);
		expect(mapper.pageToRoute(PARASHA_CONTENT_OFFSET + 4, undefined)).toBe(
			`${PARASHA_ROOT}/במדבר/גב?book`,
		);
	});

	it("maps content pages to canonical slug routes with haftara flag", () => {
		expect(mapper.pageToRoute(PARASHA_CONTENT_OFFSET, undefined)).toBe(
			`${PARASHA_ROOT}/מטות?book`,
		);
		expect(mapper.pageToRoute(PARASHA_CONTENT_OFFSET + 2, undefined)).toBe(
			`${PARASHA_ROOT}/מטות?book&haftara`,
		);
	});

	it("returns null with no units", () => {
		expect(
			buildParashaHistoryMapper([], "במדבר").pageToRoute(0, undefined),
		).toBeNull();
	});
});

describe("parashaBookExitPath", () => {
	it("lands on the canonical path for the unit a book-content path names", () => {
		expect(parashaBookExitPath("/פרשה/מטות", 7)).toBe(`${PARASHA_ROOT}/מטות`);
		// A legacy numeric segment canonicalizes on the way out.
		expect(parashaBookExitPath("/פרשה/42", 7)).toBe(`${PARASHA_ROOT}/מטות`);
	});

	it("falls back on book chrome and unmatched paths", () => {
		expect(parashaBookExitPath("/פרשה/במדבר/תוכן", 7)).toBe(
			`${PARASHA_ROOT}/ויצא`,
		);
		expect(parashaBookExitPath("/929/1", 7)).toBe(`${PARASHA_ROOT}/ויצא`);
	});
});

describe("document titles", () => {
	it("composes flat and perush titles", () => {
		expect(parashaUnitDocumentTitle("מטות")).toContain("פרשת מטות");
		expect(parashaPerushDocumentTitle('רש"י', "מטות", false)).toContain(
			"על פרשת מטות",
		);
		expect(parashaPerushDocumentTitle('רש"י', "מטות", true)).toContain(
			"על הפטרת מטות",
		);
	});
});

describe("unitBoundaryMarkers", () => {
	it("rebuilds the serialized marker map with every layer", () => {
		// Issue #3165: the book spread serializes all applicable layers —
		// base, weekday, and custom markers share the same contract as
		// the flat page.
		const unit: ParashaBookUnit = {
			...UNIT,
			aliyahMarkers: {
				"172:1": [
					{
						key: "matot:shabbat",
						label: "ראשון",
						role: "aliyah",
						tag: "שבת",
						category: "shabbat",
						detail: "פרשת מטות · קריאת שבת · עלייה ראשונה (במדבר ל ב - לב מב)",
					},
					{
						key: "matot-masei:shabbat",
						label: "ראשון",
						role: "aliyah",
						tag: "מטות-מסעי",
						category: "joined",
						detail: "מטות-מסעי · קריאת שבת · עלייה ראשונה (במדבר ל ב - לה יג)",
					},
				],
			},
			aliyahEmphasisKey: "matot:shabbat",
		};

		const map = unitBoundaryMarkers(unit);

		expect(map?.get("172:1")?.map((marker) => marker.key)).toEqual([
			"matot:shabbat",
			"matot-masei:shabbat",
		]);
		expect(map?.get("172:1")?.[1]).toMatchObject({
			tag: "מטות-מסעי",
			category: "joined",
		});
	});

	it("returns undefined for a unit without markers", () => {
		expect(unitBoundaryMarkers(UNIT)).toBeUndefined();
	});
});
