/**
 * @jest-environment node
 */
import {
	htmlToPlainText,
	normalizeSearchText,
	normalizeWithMap,
	searchTokens,
} from "@/lib/search/normalize";

describe("normalizeSearchText", () => {
	it("strips niqqud and taamim so vocalized and plain text match", () => {
		expect(normalizeSearchText("בְּרֵאשִׁ֖ית")).toBe("בראשית");
		expect(normalizeSearchText("בָּרָ֣א")).toBe("ברא");
	});

	it("removes quote-like characters including geresh and gershayim", () => {
		expect(normalizeSearchText('תנ"ך')).toBe("תנך");
		expect(normalizeSearchText("רש״י")).toBe("רשי");
		expect(normalizeSearchText("שליט״א")).toBe("שליטא");
		expect(normalizeSearchText("it's")).toBe("its");
	});

	it("lowercases latin letters and collapses punctuation to single spaces", () => {
		expect(normalizeSearchText("Hello,  World!")).toBe("hello world");
		expect(normalizeSearchText("בראשית - בראשית")).toBe("בראשית בראשית");
	});

	it("keeps digits", () => {
		expect(normalizeSearchText("פרק 32")).toBe("פרק 32");
	});

	it("preserves mapped normalization throughout the Hebrew and ASCII fast path", () => {
		for (const [first, last] of [
			[0, 0x7f],
			[0x590, 0x5ff],
			[0x2000, 0x206f],
		]) {
			for (let code = first; code <= last; code++) {
				const char = String.fromCodePoint(code);
				const text = `א${char}A${char}בְּרֵאשִׁית`;
				expect(normalizeSearchText(text)).toBe(
					normalizeWithMap(text).normalized,
				);
			}
		}
	});

	it("does not decompose large text containing only Hebrew, ASCII and punctuation", () => {
		const text = 'בְּרֵאשִׁית Hello—תנ"ך '.repeat(10_000);
		const spy = jest
			.spyOn(String.prototype, "normalize")
			.mockImplementation(() => {
				throw new Error("Unnecessary Unicode decomposition");
			});
		try {
			expect(normalizeSearchText(text)).toBe(
				"בראשית hello תנך ".repeat(10_000).trim(),
			);
		} finally {
			spy.mockRestore();
		}
	});

	it("preserves per-code-point Greek, titlecase and Roman-numeral casing", () => {
		expect(normalizeSearchText("ΟΣ ΣΣ ǅ Ⅰ Ⅱ")).toBe("οσ σσ ǆ ⅰ ⅱ");
		expect(normalizeSearchText("א\u20ddב \ud800x\udc00")).toBe("א ב x");
	});

	it("agrees with mapped normalization across every Unicode scalar", () => {
		for (let first = 0; first <= 0x10ffff; first += 256) {
			const points: string[] = [];
			for (let code = first; code < Math.min(first + 256, 0x110000); code++) {
				if (code < 0xd800 || code > 0xdfff)
					points.push(String.fromCodePoint(code));
			}
			const text = `ΟΣ Ⅰ ǅ ${points.join("")} בְּרֵאשִׁית`;
			expect(normalizeSearchText(text)).toBe(normalizeWithMap(text).normalized);
		}
	});

	it("trims and returns empty for punctuation-only input", () => {
		expect(normalizeSearchText("  ---  ")).toBe("");
		expect(normalizeSearchText("")).toBe("");
	});
});

describe("searchTokens", () => {
	it("splits a normalized phrase into terms", () => {
		expect(searchTokens("  בְּרֵאשִׁית בָּרָא ")).toEqual(["בראשית", "ברא"]);
	});

	it("returns an empty array for a non-word query", () => {
		expect(searchTokens("---")).toEqual([]);
	});
});

describe("htmlToPlainText", () => {
	it("strips tags and keeps text", () => {
		expect(htmlToPlainText("<p>שלום <b>עולם</b></p>")).toBe("שלום עולם");
	});

	it("turns block-level boundaries into spaces", () => {
		expect(htmlToPlainText("<p>ראשון</p><p>שני</p>")).toBe("ראשון שני");
		expect(htmlToPlainText("א<br>ב")).toBe("א ב");
	});

	it("removes script and style contents entirely", () => {
		expect(
			htmlToPlainText("<p>טקסט</p><script>alert(1)</script><p>עוד</p>"),
		).toBe("טקסט  עוד");
	});

	it("strips tags nested inside other tag fragments until stable", () => {
		// Single-pass removal would leave a re-formed "<script>" behind.
		expect(htmlToPlainText("<scr<script>ipt>alert(1)</script>")).not.toContain(
			"<script",
		);
		expect(htmlToPlainText("א<<b>b>ב")).not.toContain("<");
	});

	it("stops scanning a large plain remainder for tags once all openers are removed", () => {
		const html = "<p>שלום </p>".repeat(10_000);
		const plain = "שלום  ".repeat(10_000).trim();
		const replace = String.prototype.replace;
		const spy = jest
			.spyOn(String.prototype, "replace")
			.mockImplementation(function (this: string, pattern, replacement) {
				if (
					pattern instanceof RegExp &&
					pattern.source.includes("<") &&
					!this.includes("<")
				) {
					throw new Error("Unnecessary full-body tag scan");
				}
				return replace.call(this, pattern, replacement);
			});
		try {
			expect(htmlToPlainText(html)).toBe(plain);
		} finally {
			spy.mockRestore();
		}
	});

	it("decodes named and numeric entities", () => {
		expect(htmlToPlainText("א&nbsp;ב")).toBe("א ב");
		expect(htmlToPlainText("&lt;b&gt;")).toBe("<b>");
		expect(htmlToPlainText("&#1513;&#1500;&#1493;&#1501;")).toBe("שלום");
		expect(htmlToPlainText("&#x5E9;&#X5DC;&#x5D5;&#x5DD;")).toBe("שלום");
		expect(htmlToPlainText("&quot;hi&quot;")).toBe('"hi"');
	});

	it("leaves out-of-range numeric entities untouched", () => {
		expect(htmlToPlainText("&#x2000000;")).toBe("&#x2000000;");
		expect(htmlToPlainText("&#99999999;")).toBe("&#99999999;");
	});

	it("passes plain text through entity decoding only", () => {
		expect(htmlToPlainText("א &amp; ב")).toBe("א & ב");
	});

	it("leaves unknown entities untouched", () => {
		expect(htmlToPlainText("&notanentity;")).toBe("&notanentity;");
	});
});
