/**
 * Tests for the parasha book helpers: history mapping, exit paths,
 * document titles, and the serialized-boundary-marker rebuild (issue
 * #2519).
 */
import {
	buildParashaHistoryMapper,
	PARASHA_CONTENT_OFFSET,
	PARASHA_ROOT,
	type ParashaBookUnit,
	parashaBookExitPath,
	parashaPerushDocumentTitle,
	parashaUnitDocumentTitle,
	unitBoundaryMarkers,
} from "../../../src/app/parasha/[unit]/components/parasha-book-utils";

const UNIT: ParashaBookUnit = {
	unitId: 42,
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

	it("maps content pages to unit routes with haftara flag", () => {
		expect(mapper.pageToRoute(PARASHA_CONTENT_OFFSET, undefined)).toBe(
			`${PARASHA_ROOT}/42?book`,
		);
		expect(mapper.pageToRoute(PARASHA_CONTENT_OFFSET + 2, undefined)).toBe(
			`${PARASHA_ROOT}/42?book&haftara`,
		);
	});

	it("returns null with no units", () => {
		expect(
			buildParashaHistoryMapper([], "במדבר").pageToRoute(0, undefined),
		).toBeNull();
	});
});

describe("parashaBookExitPath", () => {
	it("lands on the unit a book-content path names", () => {
		expect(parashaBookExitPath("/פרשה/42", 7)).toBe(`${PARASHA_ROOT}/42`);
	});

	it("falls back on book chrome and unmatched paths", () => {
		expect(parashaBookExitPath("/פרשה/במדבר/תוכן", 7)).toBe(
			`${PARASHA_ROOT}/7`,
		);
		expect(parashaBookExitPath("/929/1", 7)).toBe(`${PARASHA_ROOT}/7`);
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
	it("rebuilds the serialized marker map", () => {
		const unit: ParashaBookUnit = {
			...UNIT,
			aliyahMarkers: {
				"172:1": [{ key: "matot:shabbat", label: "ראשון", role: "aliyah" }],
			},
			aliyahMarkerKey: "matot:shabbat",
		};

		const map = unitBoundaryMarkers(unit);

		expect(map?.get("172:1")).toEqual([
			{ key: "matot:shabbat", label: "ראשון", role: "aliyah" },
		]);
	});

	it("returns undefined for a unit without markers", () => {
		expect(unitBoundaryMarkers(UNIT)).toBeUndefined();
	});
});
