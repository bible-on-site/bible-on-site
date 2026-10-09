/**
 * @jest-environment node
 */
import { searchSnippet } from "@/lib/search/snippet";

describe("searchSnippet", () => {
	it("wraps the matched phrase in <mark> and escapes everything else", () => {
		const html = searchSnippet("בראשית ברא אלהים", "ברא");
		expect(html).toBe("<mark>ברא</mark>שית <mark>ברא</mark> אלהים");
	});

	it("escapes HTML in the source text", () => {
		const html = searchSnippet("<p>א & ב</p>", "א");
		expect(html).toContain("<mark>א</mark>");
		expect(html).not.toContain("<p>");
		expect(html).not.toContain("</p>");
		expect(html).toContain("&amp;");
	});

	it("neutralizes injected markup from stored content", () => {
		const html = searchSnippet(
			'<img src=x onerror="alert(1)">שלום עולם',
			"שלום",
		);
		expect(html).not.toContain("<img");
		expect(html).not.toContain("onerror");
		expect(html).toContain("<mark>שלום</mark>");
	});

	it("escapes the query text rather than interpreting it", () => {
		const html = searchSnippet("א ב ג", "<b>");
		expect(html).not.toContain("<b>");
		expect(html).not.toContain("<mark>");
	});

	it("highlights fuzzy word matches, not just the literal phrase", () => {
		const html = searchSnippet("בראשית ברא אלהים את השמים", "בראשים");
		expect(html).toContain("<mark>בראשית</mark>");
	});

	it("matches despite niqqud in the text", () => {
		const html = searchSnippet("בְּרֵאשִׁית בָּרָא אֱלֹהִים", "בראשית");
		expect(html).toContain("<mark>בְּרֵאשִׁית</mark>");
	});

	it("windows the excerpt around the first match with ellipsis", () => {
		const long = `${"א ".repeat(40)}מטרה${" ב".repeat(40)}`;
		const html = searchSnippet(long, "מטרה");
		expect(html.startsWith("...")).toBe(true);
		expect(html.endsWith("...")).toBe(true);
		expect(html).toContain("<mark>מטרה</mark>");
	});

	it("falls back to the beginning when nothing matches", () => {
		const html = searchSnippet(`${"א".repeat(80)}`, "זזזז");
		expect(html.endsWith("...")).toBe(true);
		expect(html).not.toContain("<mark>");
	});
});
