import {
	acceptQuality,
	markdownPreferred,
	parseAccept,
} from "@/lib/markdown/accept";

describe("parseAccept", () => {
	it("parses media ranges with their q-values", () => {
		const ranges = parseAccept("text/html, text/markdown;q=0.9, */*;q=0.1");
		expect(ranges).toEqual([
			{ type: "text", subtype: "html", quality: 1 },
			{ type: "text", subtype: "markdown", quality: 0.9 },
			{ type: "*", subtype: "*", quality: 0.1 },
		]);
	});

	it("defaults missing q to 1 and is case-insensitive", () => {
		expect(parseAccept("Text/Markdown")).toEqual([
			{ type: "text", subtype: "markdown", quality: 1 },
		]);
	});

	it("ignores non-q parameters entirely", () => {
		expect(parseAccept("text/markdown;level=1;version")).toEqual([
			{ type: "text", subtype: "markdown", quality: 1 },
		]);
	});

	it("drops malformed entries and invalid q-values", () => {
		expect(parseAccept("nonsense, text/markdown;q=abc, /, text/html")).toEqual([
			{ type: "text", subtype: "html", quality: 1 },
		]);
		expect(parseAccept("text/markdown;q=1.5")).toEqual([]);
		expect(parseAccept("text/markdown;q=")).toEqual([]);
	});

	it("parses an empty or absent header to no ranges", () => {
		expect(parseAccept(null)).toEqual([]);
		expect(parseAccept("")).toEqual([]);
	});
});

describe("acceptQuality", () => {
	it("returns the most specific matching range's quality", () => {
		const ranges = parseAccept("text/*;q=0.5, text/markdown;q=0.9");
		expect(acceptQuality(ranges, "text/markdown")).toBe(0.9);
		expect(acceptQuality(ranges, "text/html")).toBe(0.5);
	});

	it("keeps the exact match when a wildcard range follows it", () => {
		// Range order never matters: a later less-specific range must not
		// dilute the earlier exact match's quality.
		const ranges = parseAccept("text/markdown;q=0.9, text/*;q=0.5, */*;q=0.1");
		expect(acceptQuality(ranges, "text/markdown")).toBe(0.9);
	});

	it("falls back through text/* then */*", () => {
		expect(acceptQuality(parseAccept("text/*;q=0.7"), "text/markdown")).toBe(0.7);
		expect(acceptQuality(parseAccept("*/*;q=0.3"), "text/html")).toBe(0.3);
	});

	it("returns 0 for unmatched and q=0-excluded types", () => {
		expect(acceptQuality(parseAccept("image/png"), "text/markdown")).toBe(0);
		expect(acceptQuality(parseAccept("text/markdown;q=0"), "text/markdown")).toBe(0);
	});
});

describe("markdownPreferred", () => {
	it("is true when text/markdown outranks text/html", () => {
		expect(markdownPreferred("text/markdown")).toBe(true);
		expect(
			markdownPreferred("text/html;q=0.5, text/markdown;q=0.9"),
		).toBe(true);
		expect(markdownPreferred("text/markdown;q=1, */*;q=0.1")).toBe(true);
	});

	it("is false for a browser Accept header", () => {
		expect(
			markdownPreferred(
				"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8",
			),
		).toBe(false);
	});

	it("is false when markdown ties or loses to html", () => {
		expect(markdownPreferred("text/markdown;q=0.5, text/html;q=0.9")).toBe(
			false,
		);
		expect(markdownPreferred("text/*")).toBe(false);
		expect(markdownPreferred("*/*")).toBe(false);
	});

	it("is false for absent, malformed, and zero-quality headers", () => {
		expect(markdownPreferred(null)).toBe(false);
		expect(markdownPreferred("")).toBe(false);
		expect(markdownPreferred("text/markdown;q=0")).toBe(false);
		expect(markdownPreferred("text/markdown;q=oops")).toBe(false);
	});
});
