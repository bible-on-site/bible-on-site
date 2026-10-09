import {
	isPasukInHighlightRange,
	normalizePasukSlugHyphens,
	parsePasukSlugToRange,
} from "@/lib/tanach/tanach-pasuk-range";

describe("normalizePasukSlugHyphens", () => {
	it("trims and maps Hebrew maqaf to ASCII hyphen", () => {
		expect(normalizePasukSlugHyphens(" א־ב ")).toBe("א-ב");
	});
});

describe("parsePasukSlugToRange", () => {
	it("parses a single-letter pasuk slug", () => {
		expect(parsePasukSlugToRange("א", 10)).toEqual({ start: 1, end: 1 });
	});

	it("parses a multi-letter pasuk (e.g. לב)", () => {
		expect(parsePasukSlugToRange("לב", 40)).toEqual({ start: 32, end: 32 });
	});

	it("parses a range with ASCII hyphen", () => {
		expect(parsePasukSlugToRange("א-ג", 10)).toEqual({ start: 1, end: 3 });
	});

	it("parses a range with Hebrew maqaf in slug", () => {
		expect(parsePasukSlugToRange("א־ג", 10)).toEqual({ start: 1, end: 3 });
	});

	it("swaps when end precedes start", () => {
		expect(parsePasukSlugToRange("ג-א", 10)).toEqual({ start: 1, end: 3 });
	});

	it("returns null when out of chapter bounds", () => {
		expect(parsePasukSlugToRange("יא", 10)).toBeNull();
	});

	it("returns null for empty or invalid slug", () => {
		expect(parsePasukSlugToRange("", 5)).toBeNull();
		expect(parsePasukSlugToRange("xyz", 5)).toBeNull();
	});

	it("returns null when maxVerse is below 1", () => {
		expect(parsePasukSlugToRange("א", 0)).toBeNull();
	});
});

describe("isPasukInHighlightRange", () => {
	it("returns false when range is missing", () => {
		expect(isPasukInHighlightRange(1, null)).toBe(false);
		expect(isPasukInHighlightRange(1, undefined)).toBe(false);
	});

	it("returns true inside inclusive range", () => {
		expect(isPasukInHighlightRange(2, { start: 1, end: 3 })).toBe(true);
	});

	it("returns false outside range", () => {
		expect(isPasukInHighlightRange(4, { start: 1, end: 3 })).toBe(false);
	});
});
