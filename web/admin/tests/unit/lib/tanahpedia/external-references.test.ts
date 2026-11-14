import { describe, expect, it } from "vitest";
import {
	EXTERNAL_REFERENCE_SOURCES,
	externalReferenceDisplayId,
	isExternalReferenceSource,
	normalizeExternalReferenceUrl,
} from "~/lib/tanahpedia/external-references";

describe("isExternalReferenceSource", () => {
	it("accepts every supported source", () => {
		for (const source of EXTERNAL_REFERENCE_SOURCES) {
			expect(isExternalReferenceSource(source)).toBe(true);
		}
	});

	it("rejects unknown and non-string values", () => {
		for (const value of ["wikidata", "PARSHAN", "", 3, null, undefined]) {
			expect(isExternalReferenceSource(value)).toBe(false);
		}
	});
});

describe("normalizeExternalReferenceUrl", () => {
	describe("when the source is WIKIDATA", () => {
		it("canonicalizes a bare QID to the item URL", () => {
			expect(normalizeExternalReferenceUrl("WIKIDATA", "Q9181")).toBe(
				"https://www.wikidata.org/wiki/Q9181",
			);
		});

		it("canonicalizes a lowercase QID and surrounding whitespace", () => {
			expect(normalizeExternalReferenceUrl("WIKIDATA", "  q42  ")).toBe(
				"https://www.wikidata.org/wiki/Q42",
			);
		});

		it("canonicalizes wiki and entity item URLs", () => {
			for (const input of [
				"https://www.wikidata.org/wiki/Q9181",
				"http://www.wikidata.org/wiki/Q9181",
				"https://wikidata.org/entity/Q9181",
			]) {
				expect(normalizeExternalReferenceUrl("WIKIDATA", input)).toBe(
					"https://www.wikidata.org/wiki/Q9181",
				);
			}
		});

		it("rejects non-QID identifiers", () => {
			for (const input of [
				"P31",
				"Q0",
				"9181",
				"https://www.wikidata.org/wiki/Abraham",
				"https://example.com/Q9181",
			]) {
				expect(() => normalizeExternalReferenceUrl("WIKIDATA", input)).toThrow(
					"מזהה Wikidata לא תקין",
				);
			}
		});
	});

	describe("when the source is a Wikipedia", () => {
		it("keeps the article URL canonical on the matching host", () => {
			expect(
				normalizeExternalReferenceUrl(
					"WIKIPEDIA_HE",
					"http://he.wikipedia.org/wiki/%D7%90%D7%91%D7%A8%D7%94%D7%9D?oldid=1#section",
				),
			).toBe("https://he.wikipedia.org/wiki/%D7%90%D7%91%D7%A8%D7%94%D7%9D");
			expect(
				normalizeExternalReferenceUrl(
					"WIKIPEDIA_EN",
					"https://en.wikipedia.org/wiki/Abraham",
				),
			).toBe("https://en.wikipedia.org/wiki/Abraham");
		});

		it("rejects the wrong provider host", () => {
			expect(() =>
				normalizeExternalReferenceUrl(
					"WIKIPEDIA_HE",
					"https://en.wikipedia.org/wiki/Abraham",
				),
			).toThrow("קישור ויקיפדיה לא תקין");
			expect(() =>
				normalizeExternalReferenceUrl(
					"WIKIPEDIA_EN",
					"https://he.wikipedia.org/wiki/%D7%90%D7%91%D7%A8%D7%94%D7%9D",
				),
			).toThrow("קישור ויקיפדיה לא תקין");
		});

		it("rejects non-article paths and empty titles", () => {
			for (const input of [
				"https://he.wikipedia.org/",
				"https://he.wikipedia.org/wiki/",
				"https://he.wikipedia.org/w/index.php?title=x",
				"not a url",
			]) {
				expect(() =>
					normalizeExternalReferenceUrl("WIKIPEDIA_HE", input),
				).toThrow();
			}
		});
	});

	describe("when the source is SEFARIA", () => {
		it("accepts a topic on the canonical www host", () => {
			expect(
				normalizeExternalReferenceUrl(
					"SEFARIA",
					"https://www.sefaria.org/topics/abraham",
				),
			).toBe("https://www.sefaria.org/topics/abraham");
		});
		it("canonicalizes the host and keeps the topic path", () => {
			expect(
				normalizeExternalReferenceUrl(
					"SEFARIA",
					"http://sefaria.org/topics/abraham?utm=1",
				),
			).toBe("https://www.sefaria.org/topics/abraham");
		});

		it("rejects other hosts and the root page", () => {
			for (const input of [
				"https://www.sefaria.org/",
				"https://example.com/topics/abraham",
			]) {
				expect(() => normalizeExternalReferenceUrl("SEFARIA", input)).toThrow(
					"קישור Sefaria לא תקין",
				);
			}
		});
	});

	describe("when the source is OFFICIAL", () => {
		it("accepts any http(s) URL and canonicalizes it", () => {
			expect(
				normalizeExternalReferenceUrl("OFFICIAL", "https://example.com"),
			).toBe("https://example.com/");
			expect(
				normalizeExternalReferenceUrl(
					"OFFICIAL",
					"http://www.example.org/page?a=1",
				),
			).toBe("http://www.example.org/page?a=1");
		});

		it("rejects non-http schemes and malformed input", () => {
			for (const input of ["ftp://example.com", "javascript:alert(1)", "x"]) {
				expect(() =>
					normalizeExternalReferenceUrl("OFFICIAL", input),
				).toThrow();
			}
		});
	});

	it("rejects an empty input", () => {
		expect(() => normalizeExternalReferenceUrl("OFFICIAL", "   ")).toThrow(
			"קישור ריק",
		);
	});

	it("rejects URLs beyond the column limit", () => {
		const long = `https://example.com/${"a".repeat(1024)}`;
		expect(() => normalizeExternalReferenceUrl("OFFICIAL", long)).toThrow(
			"הקישור ארוך מדי",
		);
	});
});

describe("externalReferenceDisplayId", () => {
	it("returns the QID for Wikidata", () => {
		expect(
			externalReferenceDisplayId(
				"WIKIDATA",
				"https://www.wikidata.org/wiki/Q9181",
			),
		).toBe("Q9181");
	});

	it("decodes the article title for Wikipedia", () => {
		expect(
			externalReferenceDisplayId(
				"WIKIPEDIA_HE",
				"https://he.wikipedia.org/wiki/%D7%90%D7%91%D7%A8%D7%94%D7%9D",
			),
		).toBe("אברהם");
		expect(
			externalReferenceDisplayId(
				"WIKIPEDIA_EN",
				"https://en.wikipedia.org/wiki/Abraham_ibn_Ezra",
			),
		).toBe("Abraham ibn Ezra");
	});

	it("returns the topic slug for Sefaria", () => {
		expect(
			externalReferenceDisplayId(
				"SEFARIA",
				"https://www.sefaria.org/topics/abraham",
			),
		).toBe("abraham");
	});

	it("returns the hostname for official sites and falls back on bad input", () => {
		expect(
			externalReferenceDisplayId("OFFICIAL", "https://example.com/page"),
		).toBe("example.com");
		expect(externalReferenceDisplayId("OFFICIAL", "not-a-url")).toBe(
			"not-a-url",
		);
	});

	it("falls back to the raw segment when decoding fails", () => {
		expect(
			externalReferenceDisplayId(
				"WIKIPEDIA_HE",
				"https://he.wikipedia.org/wiki/%E0%A4%A",
			),
		).toBe("%E0%A4%A");
	});
});
