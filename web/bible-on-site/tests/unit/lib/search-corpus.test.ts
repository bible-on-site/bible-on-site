/**
 * @jest-environment node
 */
import {
	getPasukIndex,
	getPerekIndex,
	referenceQuery,
	searchPerakim,
	searchPesukim,
} from "@/lib/search/corpus";
import { normalizeSearchText } from "@/lib/search/normalize";

describe("getPerekIndex", () => {
	it("indexes all 929 perakim with canonical sources", () => {
		const index = getPerekIndex();
		expect(index).toHaveLength(929);
		expect(index[0].source).toBe("בראשית א");
		expect(index[31].source).toBe("בראשית לב");
		// Sefer with an additional volume keeps its letter in the source.
		const shmuel = index.find((entry) => entry.source === "שמואל ב ה");
		expect(shmuel).toBeDefined();
	});
});

describe("referenceQuery", () => {
	it("rewrites numeric words as Hebrew letters", () => {
		expect(referenceQuery("בראשית 1")).toBe("בראשית א");
		expect(referenceQuery("שמואל ב 5")).toBe("שמואל ב ה");
	});

	it("leaves non-numeric and out-of-range words alone", () => {
		expect(referenceQuery("שלום")).toBe("שלום");
		expect(referenceQuery("930")).toBe("930");
	});
});

describe("searchPerakim", () => {
	it("finds a perek by its canonical name", () => {
		const hits = searchPerakim("בראשית א", 10);
		expect(hits[0].entry.perekId).toBe(1);
		expect(hits[0].score).toBe(110);
	});

	it("matches a numeric perek reference through letter conversion", () => {
		const hits = searchPerakim("בראשית 1", 10);
		expect(hits[0].entry.perekId).toBe(1);
	});

	it("matches perek header text", () => {
		const hits = searchPerakim("בריאת העולם", 10);
		expect(hits[0].entry.perekId).toBe(1);
	});

	it("returns nothing for an unrelated query", () => {
		expect(searchPerakim("דג צפצף לול", 10)).toHaveLength(0);
	});
});

describe("searchPesukim", () => {
	it("builds an index covering every pasuk", () => {
		const index = getPasukIndex();
		// Every perek has at least a few pesukim; the corpus holds ~23k.
		expect(index.length).toBeGreaterThan(20000);
		const first = index.find(
			(entry) => entry.perekId === 1 && entry.pasukNum === 1,
		);
		expect(first?.reference).toBe("בראשית א א");
		expect(normalizeSearchText(first?.text ?? "")).toMatch(/^בראשית/);
		// Raw pointed text (niqqud/taamim) is preserved for display.
		expect(first?.text).toContain("ׁ");
	});

	it("finds pesukim by unvocalized query text", () => {
		const hits = searchPesukim("בראשית ברא אלהים את השמים", 10);
		expect(hits[0].entry.perekId).toBe(1);
		expect(hits[0].entry.pasukNum).toBe(1);
		expect(hits[0].score).toBeGreaterThanOrEqual(90);
	});

	it("finds a distinctive phrase regardless of niqqud", () => {
		const hits = searchPesukim("שמע ישראל", 10);
		expect(hits.length).toBeGreaterThan(0);
		const refs = hits.map((hit) => hit.entry.reference);
		expect(refs).toContain("דברים ו ד");
	});

	it("respects the limit", () => {
		const hits = searchPesukim("את", 5);
		expect(hits.length).toBeLessThanOrEqual(5);
	});
});
