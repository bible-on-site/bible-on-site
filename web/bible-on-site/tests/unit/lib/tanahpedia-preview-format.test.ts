jest.mock("isomorphic-dompurify", () => ({
	__esModule: true,
	default: { sanitize: (html: string) => html },
}));

import {
	toPlainTextPreview,
	toPreviewHtml,
	truncatePreviewSnippet,
} from "../../../src/lib/tanahpedia/preview-format";

describe("tanahpedia/preview-format", () => {
	describe("toPreviewHtml", () => {
		it("strips superscripts and flattens paragraphs to br", () => {
			const html = '<p>א</p><sup><a href="#n">א</a></sup><p>ב</p><hr><p>ג</p>';
			expect(toPreviewHtml(html)).toBe("א<br>ב<br>ג");
		});

		it("normalizes headers and flattens paragraphs to br", () => {
			// Sanitization (script / attribute removal) is delegated to DOMPurify,
			// mocked here as a passthrough and exercised against the real server in E2E.
			const html = "<h2>כותרת</h2><p>טקסט</p>";
			expect(toPreviewHtml(html)).toBe("<h2>כותרת</h2>טקסט");
		});

		it("skips empty headers and collapses duplicate br", () => {
			const html = "<h2></h2><p>א</p><br><br><p>ב</p>";
			expect(toPreviewHtml(html)).toBe("א<br>ב");
		});

		it("trims leading br and trailing br", () => {
			expect(toPreviewHtml("<br><p>x</p><br>")).toBe("x");
		});

		it("handles literal backslash-n in source", () => {
			expect(toPreviewHtml("a\\nb")).toBe("ab");
		});
	});

	describe("truncatePreviewSnippet", () => {
		it("counts an unterminated tag as text when truncating malformed snippets", () => {
			expect(truncatePreviewSnippet("ab<cd", 3)).toBe("ab<…");
		});
		it("returns unchanged when text under limit", () => {
			const s = "<h2>א</h2>ב";
			expect(truncatePreviewSnippet(s, 100)).toBe(s);
		});

		it("truncates by visible text length and adds ellipsis", () => {
			const plain = "x".repeat(400);
			const snippet = `<p>${plain}</p>`;
			const out = truncatePreviewSnippet(snippet, 10);
			expect(out.endsWith("…")).toBe(true);
			const visibleLen = (out.match(/x/g) ?? []).length;
			expect(visibleLen).toBeLessThanOrEqual(10);
		});

		it("closes unclosed h3 when truncating inside it", () => {
			const snippet = `${"<h3>"}${"א".repeat(500)}`;
			const out = truncatePreviewSnippet(snippet, 5);
			expect(out).toContain("</h3>");
			expect(out).toContain("…");
		});

		it("returns original when cutIdx stays zero for empty string", () => {
			expect(truncatePreviewSnippet("", 10)).toBe("");
		});
	});

	describe("toPlainTextPreview", () => {
		const words = (count: number) =>
			Array.from({ length: count }, (_, i) => `מילה${i + 1}`).join(" ");

		it("keeps at most the requested whole words and marks truncation", () => {
			const all = words(25);
			const out = toPlainTextPreview(["<p>", all, "</p>"].join(""), 20);
			expect(out).toBe(`${words(20)}…`);
			// The cut lands on a word boundary — no partial word, no space
			// before the ellipsis.
			expect(out.split("…")[0].endsWith(" ")).toBe(false);
		});

		it("returns the body intact when it fits the word cap", () => {
			expect(
				toPlainTextPreview(["<p>", words(20), "</p>"].join(""), 20),
			).toBe(words(20));
			expect(toPlainTextPreview("<p>אחת שתיים</p>", 20)).toBe("אחת שתיים");
		});

		it("honours block boundaries so adjacent words never merge", () => {
			expect(toPlainTextPreview("<p>אחת</p><p>שתיים</p>", 20)).toBe(
				"אחת שתיים",
			);
			// Boundaries are marked before sanitization, so stripped block
			// tags can never concatenate sibling items either.
			expect(
				toPlainTextPreview("<ol><li>אחת</li><li>שתיים</li></ol>", 20),
			).toBe("אחת שתיים");
			expect(
				toPlainTextPreview(
					"<table><tr><td>אחת</td><td>שתיים</td></tr></table>" +
						"<div>שלוש</div><section><ul><li>ארבע</li></ul></section>",
					20,
				),
			).toBe("אחת שתיים שלוש ארבע");
		});

		it("drops bare-anchor footnote markers instead of merging their letters", () => {
			// Legacy generation (#2615): the marker is a plain anchor whose
			// text is the marker letter — unwrapped, it would merge into the
			// neighbouring word.
			expect(
				toPlainTextPreview(
					'<p>חברו<a href="#note-54" data-link-type="comment">נד</a> בעולם.</p>',
					20,
				),
			).toBe("חברו בעולם.");
			// A marker whose note body never canonicalizes still drops.
			expect(
				toPlainTextPreview('<p>מילה<a href="#note-2">ב</a> נוספת.</p>', 20),
			).toBe("מילה נוספת.");
		});

		it("omits canonical footnote refs and keeps note prose readable", () => {
			const html =
				'<p>גוף הערך<sup id="fnref:1"><a href="#fn:1" role="doc-noteref">א</a></sup> ממשיך.</p>' +
				'<ol class="footnotes"><li id="fn:1"><p>טקסט ההערה.</p></li></ol>';
			expect(toPlainTextPreview(html, 20)).toBe(
				"גוף הערך ממשיך. טקסט ההערה.",
			);
		});

		it("keeps cross-note prose links inside note bodies", () => {
			// A `#note-N` link inside a note is prose, not a marker — the
			// normalizer retargets it to `#fn:N` and the preview must keep
			// its text (data-link-type stays on the anchor harmlessly).
			const html =
				"<p>גוף</p>" +
				'<ol><li id="note-1">ראה גם <a href="#note-2" data-link-type="comment">הערה ב</a> להרחבה</li>' +
				'<li id="note-2">טקסט שני</li></ol>';
			expect(toPlainTextPreview(html, 20)).toBe(
				"גוף ראה גם הערה ב להרחבה טקסט שני",
			);
		});

		it("drops generated backref furniture without touching note prose", () => {
			// Backrefs inside note bodies are removed by the normalizer; a
			// stray one outside must not leak its glyph/text either.
			const html =
				'<p>גוף<sup id="fnref:1"><a href="#fn:1" role="doc-noteref">א</a></sup></p>' +
				'<ol class="footnotes"><li id="fn:1"><p>טקסט ההערה.</p></li></ol>' +
				'<p>שורה <a class="footnote-backref" role="doc-backlink" href="#fnref:1">חזרה</a> נוספת</p>';
			expect(toPlainTextPreview(html, 20)).toBe(
				"גוף טקסט ההערה. שורה נוספת",
			);
		});

		it("drops script/style contents and sup markers entirely", () => {
			// DOMPurify is a passthrough mock here; the executable-content
			// strip runs in the formatter itself so neither pass can leak it.
			const html =
				"<script>var secret = 1;</script><p>אחת</p>" +
				"<style>.x{}</style><sup><a>12</a></sup><p>שתיים</p>";
			expect(toPlainTextPreview(html, 20)).toBe("אחת שתיים");
		});

		it("decodes entities and collapses nbsp to spaces", () => {
			expect(toPlainTextPreview("<p>אחת&nbsp;שתיים &amp; שלוש</p>", 20)).toBe(
				"אחת שתיים & שלוש",
			);
		});

		it("preserves Hebrew combining marks and attached punctuation", () => {
			expect(
				toPlainTextPreview("<p>פֶּסַח, חַג הַמַּצּוֹת.</p>", 20),
			).toBe("פֶּסַח, חַג הַמַּצּוֹת.");
		});

		it("returns empty for empty or marker-only bodies", () => {
			expect(toPlainTextPreview("", 20)).toBe("");
			expect(toPlainTextPreview("<p></p>", 20)).toBe("");
			expect(toPlainTextPreview("<p>&nbsp;</p>", 20)).toBe("");
			expect(toPlainTextPreview("<sup>1</sup>", 20)).toBe("");
		});
	});
});
