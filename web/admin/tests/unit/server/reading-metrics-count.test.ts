import { describe, expect, it } from "vitest";
import {
	READING_METRICS_CALC_VERSION,
	READING_WORDS_PER_MINUTE,
	countHtmlBlocks,
	countTextWords,
	decodeEntities,
	estimateReadingSeconds,
	htmlToPlainText,
	htmlToReadableSegments,
	normalizeForCount,
	pasukCountedText,
	stripScriptsAndStyles,
} from "../../../../shared/reading-metrics/index";

describe("estimateReadingSeconds", () => {
	it("computes ceil(wordCount * 60 / wpm)", () => {
		expect(estimateReadingSeconds(220)).toBe(60);
		expect(estimateReadingSeconds(221)).toBe(61);
		expect(estimateReadingSeconds(1)).toBe(1);
		expect(estimateReadingSeconds(440)).toBe(120);
	});

	it("returns 0 for a verified-empty body", () => {
		expect(estimateReadingSeconds(0)).toBe(0);
		expect(estimateReadingSeconds(-5)).toBe(0);
	});

	it("uses the shared Hebrew baseline of 220 wpm", () => {
		expect(READING_WORDS_PER_MINUTE).toBe(220);
		expect(READING_METRICS_CALC_VERSION).toBe(1);
	});
});

describe("normalizeForCount", () => {
	it("strips niqqud and taamim without splitting words", () => {
		expect(normalizeForCount("בְּרֵאשִׁ֖ית")).toBe("בראשית");
		expect(normalizeForCount("בָּרָ֣א אֱלֹהִ֑ים")).toBe("ברא אלהים");
	});

	it("drops quotes so abbreviations stay single words", () => {
		expect(normalizeForCount('תנ"ך')).toBe("תנך");
		expect(normalizeForCount('שליט"א')).toBe("שליטא");
		expect(normalizeForCount("שמואל א'")).toBe("שמואל א");
	});

	it("treats maqaf and hyphen as intra-word joiners", () => {
		expect(normalizeForCount("בית־לחם")).toBe("בית־לחם");
		expect(normalizeForCount("well-known")).toBe("well-known");
	});

	it("collapses punctuation and whitespace to separators", () => {
		expect(normalizeForCount("  שלום,   עולם! ")).toBe("שלום עולם");
		expect(normalizeForCount("א:ב")).toBe("א ב");
		expect(normalizeForCount("א ב")).toBe("א ב");
	});
});

describe("countTextWords", () => {
	it("counts Hebrew prose", () => {
		expect(countTextWords("בראשית ברא אלהים")).toBe(3);
	});

	it("counts maqaf-joined words as one", () => {
		expect(countTextWords("בית־לחם")).toBe(1);
		expect(countTextWords("וכל־הארץ")).toBe(1);
	});

	it("counts a standalone dash as no word", () => {
		expect(countTextWords("א - ב")).toBe(2);
		expect(countTextWords("א -ב")).toBe(2);
		expect(countTextWords("-")).toBe(0);
		expect(countTextWords("־")).toBe(0);
	});

	it("handles mixed scripts, digits and quotes", () => {
		expect(countTextWords("hello world")).toBe(2);
		expect(countTextWords("שנת 2024")).toBe(2);
		expect(countTextWords("word's end")).toBe(2);
	});

	it("returns 0 for empty input", () => {
		expect(countTextWords("")).toBe(0);
		expect(countTextWords("   ")).toBe(0);
		expect(countTextWords("…")).toBe(0);
	});
});

describe("htmlToPlainText", () => {
	it("strips markup and decodes entities", () => {
		expect(htmlToPlainText("<b>bold</b> and <i>it</i>")).toBe("bold and it");
		expect(htmlToPlainText("fish &lt; meat &amp; &gt; veg")).toBe(
			"fish < meat & > veg",
		);
		// NBSP decodes to its character; normalizeForCount maps it to a space
		// for counting.
		expect(htmlToPlainText("a&nbsp;b")).toBe(`a${String.fromCharCode(160)}b`);
		expect(countTextWords(htmlToPlainText("a&nbsp;b"))).toBe(2);
		expect(htmlToPlainText("&#65;&#x42;")).toBe("AB");
	});

	it("removes script and style blocks with their content", () => {
		expect(htmlToPlainText("x<script>alert(1)</script>y")).toBe("xy");
		expect(htmlToPlainText("a<style>x{}</style>b")).toBe("ab");
		expect(htmlToPlainText("a<scriptx>y</scriptx>b")).toBe("ayb");
	});

	it("keeps literal angle brackets that cannot start tags", () => {
		expect(htmlToPlainText("a < b")).toBe("a < b");
		expect(htmlToPlainText("dangling <")).toBe("dangling <");
		expect(htmlToPlainText("unclosed <b text")).toBe("unclosed <b text");
	});

	it("treats block boundaries as separators", () => {
		expect(htmlToPlainText("<p>one</p><p>two</p>")).toBe("one two");
		expect(htmlToPlainText("a<br>b")).toBe("a b");
		expect(htmlToPlainText("<div>x</div>tail")).toBe("x tail");
	});
});

describe("htmlToReadableSegments", () => {
	it("splits at block closes and void breaks", () => {
		expect(htmlToReadableSegments("<p>א</p><p>ב</p>")).toEqual(["א", "ב"]);
		expect(htmlToReadableSegments("a<br>b")).toEqual(["a", "b"]);
		expect(htmlToReadableSegments("<ul><li>x</li><li>y</li></ul>")).toEqual([
			"x",
			"y",
		]);
	});

	it("keeps inline markup inside one block", () => {
		expect(htmlToReadableSegments("<p>a <b>bold</b> c</p>")).toEqual([
			"a bold c",
		]);
	});
});

describe("decodeEntities", () => {
	it("decodes named and numeric entities", () => {
		expect(decodeEntities("&quot;q&quot;")).toBe('"q"');
		expect(decodeEntities("&#39; &#x27;")).toBe("' '");
	});

	it("leaves unknown, unterminated and out-of-range entities literal", () => {
		expect(decodeEntities("&bogus;")).toBe("&bogus;");
		expect(decodeEntities("&#x110000;")).toBe("&#x110000;");
		expect(decodeEntities("no &amp entity here")).toBe("no &amp entity here");
	});
});

describe("stripScriptsAndStyles", () => {
	it("is a no-op without '<'", () => {
		expect(stripScriptsAndStyles("plain text")).toBe("plain text");
	});
});

describe("countHtmlBlocks", () => {
	it("returns zero blocks for empty content", () => {
		expect(countHtmlBlocks(null)).toEqual({ wordCount: 0, blocks: [] });
		expect(countHtmlBlocks("<p></p>")).toEqual({ wordCount: 0, blocks: [] });
	});

	it("counts blocks in document order with a matching total", () => {
		const html = "<p>אחת שתים</p><p>שלוש</p><ul><li>ארבע חמש</li></ul>";
		expect(countHtmlBlocks(html)).toEqual({
			wordCount: 5,
			blocks: [2, 1, 2],
		});
	});

	it("drops word-free blocks so only reading units are stored", () => {
		expect(countHtmlBlocks("<p>אחת</p><p></p><p>שתים</p>").blocks).toEqual([
			1, 1,
		]);
	});
});

describe("pasukCountedText", () => {
	it("counts qri words and skips section marks", () => {
		const pasuk = {
			segments: [
				{ type: "qri" as const, value: "בְּרֵאשִׁ֖ית" },
				{ type: "qri" as const, value: "בָּרָ֣א" },
				{ type: "stuma" as const },
				{ type: "qri" as const, value: "אֱלֹהִ֑ים" },
			],
		};
		expect(countTextWords(pasukCountedText(pasuk))).toBe(3);
	});

	it("skips a ktiv paired with a differing qri but keeps orphan ktiv", () => {
		const paired = {
			segments: [
				{ type: "ktiv" as const, value: "abc", qriOffset: 1 },
				{ type: "qri" as const, value: "def" },
			],
		};
		expect(pasukCountedText(paired)).toBe("def");
		const orphan = {
			segments: [{ type: "ktiv" as const, value: "abc", qriOffset: 0 }],
		};
		expect(pasukCountedText(orphan)).toBe("abc");
	});

	it("glues a maqaf-final segment to the next word", () => {
		const pasuk = {
			segments: [
				{ type: "qri" as const, value: "בית־" },
				{ type: "qri" as const, value: "לחם" },
			],
		};
		expect(pasukCountedText(pasuk)).toBe("בית־לחם");
		expect(countTextWords(pasukCountedText(pasuk))).toBe(1);
	});

	it("handles segments without values", () => {
		const pasuk = {
			segments: [
				{ type: "ptuha" as const },
				{ type: "qri" as const, value: "א" },
			],
		};
		expect(pasukCountedText(pasuk)).toBe("א");
	});
});
