import { decorateArticleHtml } from "@/lib/tanahpedia/decorate-article-html";
import type { ArticleMentionReference } from "@/lib/tanahpedia/service";

// join(), not a template literal or '+' chain — mirrors the decorator's
// anchor shape while satisfying both linters' string-build rules.
function mentionAnchor(name: string, text: string): string {
	return [
		'<a class="tanahpedia-mention" href="/pedia/',
		encodeURIComponent(name),
		'">',
		text,
		"</a>",
	].join("");
}

function ref(
	html: string,
	start: number,
	end: number,
	entryUniqueName: string | null = "ישראל",
): ArticleMentionReference {
	return { spanStart: start, spanEnd: end, surface: html.slice(start, end), entryUniqueName };
}

describe("decorateArticleHtml", () => {
	it("returns the html unchanged when there is nothing to decorate", () => {
		const html = "<p>טקסט רגיל</p>";
		expect(decorateArticleHtml(html, [])).toBe(html);
	});

	it("returns the html unchanged when every ref is unresolved", () => {
		const html = "<p>אברם אבינו</p>";
		expect(decorateArticleHtml(html, [ref(html, 3, 7, null)])).toBe(html);
	});

	it("wraps a resolved span in a dashed Tanahpedia anchor", () => {
		const html = "<p>ויאמר אל אברם</p>";
		const start = html.indexOf("אברם");
		const out = decorateArticleHtml(html, [
			ref(html, start, start + 4, "אברם-אבינו"),
		]);
		expect(out).toBe(
			["<p>ויאמר אל ", mentionAnchor("אברם-אבינו", "אברם"), "</p>"].join(""),
		);
	});

	it("encodes the entry name in the href", () => {
		const html = "<p>בית אל</p>";
		const start = html.indexOf("בית אל");
		const out = decorateArticleHtml(html, [
			ref(html, start, start + 6, "בית אל"),
		]);
		expect(out).toContain(`href="/pedia/${encodeURIComponent("בית אל")}"`);
		expect(out).toContain(">בית אל</a>");
	});

	it("decorates multiple spans in document order regardless of input order", () => {
		const html = "<p>אברם פגש את מצרים</p>";
		const a = html.indexOf("אברם");
		const b = html.indexOf("מצרים");
		const out = decorateArticleHtml(html, [
			ref(html, b, b + 5, "מצרים"),
			ref(html, a, a + 4, "אברם"),
		]);
		expect(out.indexOf('href="/pedia/')).toBeLessThan(out.lastIndexOf('href="/pedia/'));
		expect(out).toContain(">אברם</a>");
		expect(out).toContain(">מצרים</a>");
	});

	it("keeps the first of two overlapping spans", () => {
		const html = "<p>אברם אבינו</p>";
		const a = html.indexOf("אברם");
		const b = html.indexOf("אבינו");
		const out = decorateArticleHtml(html, [
			ref(html, a, b + 5, "אברם אבינו"), // covers both words
			ref(html, b, b + 5, "אבינו"), // overlaps the tail of the first
		]);
		expect(out).toContain(">אברם אבינו</a>");
		expect((out.match(/tanahpedia-mention/g) ?? []).length).toBe(1);
	});

	it("decorates adjacent spans back to back", () => {
		const html = "<p>אברםיצחק</p>";
		const a = html.indexOf("אברם");
		const out = decorateArticleHtml(html, [
			ref(html, a, a + 4, "אברם"),
			ref(html, a + 4, a + 8, "יצחק"),
		]);
		expect(out).toBe(
			["<p>", mentionAnchor("אברם", "אברם"), mentionAnchor("יצחק", "יצחק"), "</p>"].join(""),
		);
	});

	it("drops a ref whose surface does not match the stored span", () => {
		const html = "<p>אברם</p>";
		const drifted: ArticleMentionReference = {
			spanStart: html.indexOf("אברם"),
			spanEnd: html.indexOf("אברם") + 4,
			surface: "משה",
			entryUniqueName: "משה",
		};
		expect(decorateArticleHtml(html, [drifted])).toBe(html);
	});

	it("drops empty spans", () => {
		const html = "<p>אברם</p>";
		const out = decorateArticleHtml(html, [
			{ spanStart: 3, spanEnd: 3, surface: "", entryUniqueName: "אברם" },
		]);
		expect(out).toBe(html);
	});

	it("never nests an anchor inside an existing anchor", () => {
		const html = '<p><a href="/929/1">אברם</a> הלך</p>';
		const start = html.indexOf("אברם");
		const out = decorateArticleHtml(html, [
			ref(html, start, start + 4, "אברם"),
		]);
		expect(out).toBe(html);
	});

	it("still decorates after a closed anchor", () => {
		const html = '<p><a href="/x">קישור</a> אברם</p>';
		const start = html.indexOf("אברם");
		const out = decorateArticleHtml(html, [
			ref(html, start, start + 4, "אברם"),
		]);
		expect(out).toContain(">אברם</a>");
	});

	it("never decorates inside script or style bodies", () => {
		// Tag built dynamically so no literal `<script>` sits beside a
		// variable reference (markup-heuristic noise).
		const scriptTag = ["<", "script", ">"].join("");
		const scriptEnd = ["</", "script", ">"].join("");
		const html = [
			"<p>",
			scriptTag,
			"אברם",
			scriptEnd,
			"<style>אברם</style>אברם</p>",
		].join("");
		const last = html.lastIndexOf("אברם");
		const inside: ArticleMentionReference = {
			spanStart: html.indexOf("אברם"),
			spanEnd: html.indexOf("אברם") + 4,
			surface: "אברם",
			entryUniqueName: "אברם",
		};
		const out = decorateArticleHtml(html, [
			inside,
			{ ...inside, spanStart: html.indexOf("אברם", 30), spanEnd: html.indexOf("אברם", 30) + 4 },
			ref(html, last, last + 4, "אברם"),
		]);
		expect((out.match(/tanahpedia-mention/g) ?? []).length).toBe(1);
	});

	it("treats an unclosed anchor as blocking the rest of the document", () => {
		const html = '<p><a href="/x">אברם';
		const start = html.indexOf("אברם");
		const out = decorateArticleHtml(html, [
			ref(html, start, start + 4, "אברם"),
		]);
		expect(out).toBe(html);
	});

	it("skips a span that straddles an anchor boundary", () => {
		const html = '<p>אבר<a href="/x">ם אבינו</a></p>';
		const start = html.indexOf("אבר");
		const end = html.indexOf("אבינו") + 5;
		const out = decorateArticleHtml(html, [ref(html, start, end, "אברם")]);
		expect(out).toBe(html);
	});

	it("ignores stray closing tags when computing blocked ranges", () => {
		const html = "<p></a>אברם</p>";
		const start = html.indexOf("אברם");
		const out = decorateArticleHtml(html, [
			ref(html, start, start + 4, "אברם"),
		]);
		expect(out).toContain(">אברם</a>");
	});

	it("blocks mentions inside an anchor that wraps a nested skip element", () => {
		// Nested ranges close inner-first, so the style's range precedes
		// the anchor's — the scan must still see both as one merged zone.
		const styleTag = ["<", "style", ">"].join("");
		const styleEnd = ["</", "style", ">"].join("");
		const html = [
			'<p><a href="/old">אברם',
			styleTag,
			"x",
			styleEnd,
			" עוד</a> מצרים</p>",
		].join("");
		const insideAnchor = html.indexOf("אברם");
		const after = html.indexOf("מצרים");
		const out = decorateArticleHtml(html, [
			ref(html, insideAnchor, insideAnchor + 4, "אברם"),
			ref(html, after, after + 5, "מצרים"),
		]);
		expect(out).not.toContain('a href="/old">אברם<a');
		expect(out).not.toContain('">אברם</a>');
		expect(out).toContain('href="/pedia/%D7%9E%D7%A6%D7%A8%D7%99%D7%9D"');
	});
});
