import { describe, expect, it } from "vitest";
import type { CataloguePerek } from "~/lib/article-linking/catalogue";
import { searchCataloguePerakim } from "~/lib/article-linking/perek-search";

const row = (
	id: number,
	seferName: string,
	perekInContext: number,
	additionalLetter: string | null = null,
	pasukCount: number | null = 31,
): CataloguePerek => ({
	id,
	seferName,
	perekInContext,
	additionalLetter,
	pasukCount,
});
const rows = [
	row(1, "בראשית", 1),
	row(2, "בראשית", 2),
	row(11, "בראשית", 11),
	row(15, "בראשית", 15),
	row(16, "בראשית", 16),
	row(105, "שמואל", 5, "א"),
	row(106, "שמואל", 6, "א"),
	row(205, "שמואל", 5, "ב"),
	row(301, "תהילים", 119),
	row(401, "עזרא", 3, "ע"),
	row(402, "עזרא", 3, "נ"),
	row(501, "שיר השירים", 1),
	row(601, "דברי הימים", 36, "ב", null),
];
const ids = (query: string, fixture = rows) =>
	searchCataloguePerakim(fixture, query).map((p) => p.id);

describe("canonical agent chapter lookup", () => {
	it.each([
		"בראשית א",
		"בראשית 1",
		"בְּרֵאשִׁית א׳",
		"בראשית פרק א",
		"בראשית א, כו",
		"בראשית א:26",
		"בראשית א:כו",
		"בראשית א:26-28",
		"בראשית א כו.",
		"בראשית פרק 1 פסוק 26",
		"בראשית א כו-כח",
		"בראשית א כו־כח",
		"בראשית פרק א פסוקים כו-כח",
	])("resolves the exact first chapter from %s", (query) =>
		expect(ids(query)).toEqual([1]),
	);
	it.each([
		["בראשית טו", 15],
		["בראשית ט״ו", 15],
		["בראשית יה", 15],
		["בראשית טז", 16],
		["בראשית יו", 16],
		["תהלים קיט", 301],
		["מזמור 119", 301],
		["נחמיה ג", 402],
		["עזרא ג", 401],
		["עזרא נ ג", 402],
		["שה״ש א", 501],
		['שה"ש א', 501],
		["דה״ה ב לו", 601],
		["דברי הימים ב 36", 601],
	])("resolves canonical and legacy reference %s", (query, id) =>
		expect(ids(String(query))).toEqual([id]),
	);
	it("keeps ambiguous split-book chapters explicit instead of choosing a part", () =>
		expect(ids("שמואל ה")).toEqual([105, 205]));
	it("supports split-book-only and exact split-book chapter queries", () => {
		expect(ids("שמואל א")).toEqual([105, 106]);
		expect(ids("שמואל א ה")).toEqual([105]);
		expect(ids("שמואל ב ה")).toEqual([205]);
		expect(ids("שמואל א 5 31")).toEqual([105]);
	});
	it.each([
		"בראשית 0",
		"בראשית אא",
		"בראשית ברא",
		"בראשית 3",
		"בראשית 01",
		"בראשית 1501",
		"בראשית 9007199254740993",
		"בראשית א לב",
		"בראשית א 0",
		"בראשית א כח-כו",
		"בראשית א א-ב-ג",
		"בראשית א א ב",
		"בראשית א פסוק",
		"בראשית א פסוקים",
		"בראשית א פסוקים 0",
		"בראשית פרק",
		"בראשית א כח-",
		"בראשית א -כח",
		"בראשית א-ב",
		"שמואל ג ה",
		"נחמיה ד",
	])("rejects malformed, missing and out-of-bounds reference %s", (query) =>
		expect(ids(query)).toEqual([]),
	);
	it("accepts a verse when the canonical corpus has no bound", () =>
		expect(ids("דברי הימים ב לו ת")).toEqual([601]));
	it("preserves free-text, book-only and numeric-ID queries", () => {
		expect(ids("בראשית")).toEqual([1, 11, 15, 16, 2]);
		expect(ids("ראש")).toEqual([1, 11, 15, 16, 2]);
		expect(ids("205")).toEqual([205]);
		expect(ids("נחמיה")).toEqual([402]);
		expect(ids("unknown")).toEqual([]);
	});
	it.each(["בראשית א", "בראשית 1"])(
		"matches only chapter one, including when every chapter10-19 exists: %s",
		(query) => {
			const fixture = Array.from({ length: 19 }, (_, i) =>
				row(i + 1, "בראשית", i + 1),
			);
			expect(ids(query, fixture)).toEqual([1]);
		},
	);
	it("keeps an ambiguous split-book verse within the candidate chapter and verse bounds", () => {
		const fixture = [
			row(105, "שמואל", 5, "א", 10),
			row(205, "שמואל", 5, "ב", 20),
			row(206, "שמואל", 6, "ב", 30),
		];
		expect(ids("שמואל ה ה", fixture)).toEqual([105, 205]);
		expect(ids("שמואל ה טו", fixture)).toEqual([205]);
		expect(ids("שמואל ה כא", fixture)).toEqual([]);
	});
	it("orders all pages independently of input order and preserves duplicate-label identity", () => {
		const fixture = [
			row(20, "בראשית", 2),
			row(11, "בראשית", 11),
			row(1, "בראשית", 1),
			row(4, "בראשית", 2),
		];
		const ordered = ids("בראשית", fixture);
		expect(ordered).toEqual([1, 11, 4, 20]);
		expect(ids("בראשית", [...fixture].reverse())).toEqual(ordered);
		expect([...ordered.slice(0, 2), ...ordered.slice(2, 4)]).toEqual(ordered);
		expect(ids("   ", fixture)).toEqual(ordered);
	});
	it("does not mutate the catalogue and deterministically breaks duplicate-label ties", () => {
		const fixture = [row(3, "בראשית", 1), row(1, "בראשית", 1)];
		const before = structuredClone(fixture);
		expect(ids("בראשית א", fixture)).toEqual([1, 3]);
		expect(fixture).toEqual(before);
	});
	it("returns an available split-book candidate without inventing an absent part", () =>
		expect(ids("שמואל ה", [row(105, "שמואל", 5, "א")])).toEqual([105]));
	it("returns no guesses for an alias absent from the corpus", () =>
		expect(ids("נחמיה ג", [])).toEqual([]));
});
