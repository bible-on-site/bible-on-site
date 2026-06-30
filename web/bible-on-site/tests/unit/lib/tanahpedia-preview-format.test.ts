jest.mock("isomorphic-dompurify", () => ({
	__esModule: true,
	default: { sanitize: (html: string) => html },
}));

import {
	toPreviewHtml,
	truncatePreviewSnippet,
} from "../../../src/lib/tanahpedia/preview-format";

describe("tanahpedia/preview-format", () => {
	describe("toPreviewHtml", () => {
		it("strips superscripts and flattens paragraphs to br", () => {
			const html =
				"<p>א</p><sup><a href=\"#n\">א</a></sup><p>ב</p><hr><p>ג</p>";
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
});
