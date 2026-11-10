jest.mock("@/lib/seo/jsonld", () => ({
	SITE_ORIGIN: "https://canonical.example",
	absUrl: (path: string) =>
		path.startsWith("http") ? path : `https://canonical.example${path.startsWith("/") ? path : `/${path}`}`,
}));

import { htmlToMarkdown } from "@/lib/markdown/html";

describe("htmlToMarkdown", () => {
	it("renders paragraphs and inline emphasis", () => {
		const md = htmlToMarkdown(
			"<p>First <strong>bold</strong> and <em>ital</em>.</p><p>Second.</p>",
		);
		expect(md).toBe("First **bold** and _ital_.\n\nSecond.");
	});

	it("renders headings at their level", () => {
		expect(htmlToMarkdown("<h2>כותרת</h2><p>טקסט</p>")).toBe(
			"## כותרת\n\nטקסט",
		);
	});

	it("renders links, absolutizing site-relative hrefs", () => {
		const md = htmlToMarkdown(
			'<p><a href="/929/1">פרק</a> and <a href="https://x.test/y">ext</a></p>',
		);
		expect(md).toBe(
			"[פרק](https://canonical.example/929/1) and [ext](https://x.test/y)",
		);
	});

	it("renders the remaining inline tags", () => {
		expect(htmlToMarkdown("<p>line<br/>break</p>")).toBe("line  \nbreak");
		expect(htmlToMarkdown("<p><s>a</s><del>b</del><strike>c</strike></p>")).toBe(
			"~~a~~~~b~~~~c~~",
		);
		expect(htmlToMarkdown("<p><code>x=1</code></p>")).toBe("`x=1`");
		expect(
			htmlToMarkdown("<p><u>u</u><ins>i</ins><mark>m</mark><small>s</small><span>sp</span></p>"),
		).toBe("uimssp");
		expect(htmlToMarkdown("<p>H<sub>2</sub>O</p>")).toBe("H~2~O");
		expect(htmlToMarkdown("<p>x<sup>2</sup></p>")).toBe("x^(2)");
	});

	it("keeps children of unknown inline wrappers", () => {
		expect(htmlToMarkdown("<p>a <abbr title=\"x\">abbr</abbr> b</p>")).toBe(
			"a abbr b",
		);
	});

	it("renders media embeds as labeled links", () => {
		expect(
			htmlToMarkdown(
				'<p><audio src="/a.mp3" title="הקלטה"></audio></p>',
			),
		).toBe("[הקלטה](https://canonical.example/a.mp3)");
		expect(
			htmlToMarkdown(
				'<p><video><source src="/v.mp4"/></video></p>',
			),
		).toBe("[video](https://canonical.example/v.mp4)");
		expect(htmlToMarkdown('<p><audio></audio></p>')).toBe("");
		expect(
			htmlToMarkdown('<p><iframe src="https://x.test/f"></iframe></p>'),
		).toBe("https://x.test/f");
	});

	it("renders horizontal rules inline and as blocks", () => {
		expect(htmlToMarkdown("<p>a<hr/>b</p>")).toBe("a\n\n---\n\nb");
		expect(htmlToMarkdown("<p>a</p><hr/><p>b</p>")).toBe("a\n\n---\n\nb");
	});

	it("renders every heading level", () => {
		expect(htmlToMarkdown("<h1>א</h1><h3>ג</h3><h6>ו</h6>")).toBe(
			"# א\n\n### ג\n\n###### ו",
		);
	});

	it("renders definition lists", () => {
		const md = htmlToMarkdown(
			"<dl><dt>מונח</dt><dd>הגדרה</dd><dt>עוד</dt><dd>שניה</dd></dl>",
		);
		expect(md).toBe("**מונח**\n: הגדרה\n**עוד**\n: שניה");
		// Non-dt/dd children are dropped.
		expect(
			htmlToMarkdown("<dl><dt>א</dt><dd>ב</dd><span>ג</span></dl>"),
		).toBe("**א**\n: ב");
	});

	it("indents continuation lines inside nested list items", () => {
		const md = htmlToMarkdown(
			"<ul><li><p>א</p><p>ב</p></li><li>ג</li></ul>",
		);
		expect(md).toBe("- א\n  ב\n- ג");
	});

	it("renders pre blocks without a language class", () => {
		expect(htmlToMarkdown("<pre>raw\ntext</pre>")).toBe("```\nraw\ntext\n```");
	});

	it("drops footnote backlinks and empty reference anchors", () => {
		expect(
			htmlToMarkdown(
				'<p><a role="doc-backlink" href="#ref">↩</a> tail</p>',
			),
		).toBe("tail");
	});

	it("falls back to the raw anchor id when it has no fn prefix", () => {
		const md = htmlToMarkdown(
			'<p><a role="doc-noteref" href="#custom-id">1</a></p>' +
				'<ol class="footnotes"><li id="custom-id">note</li></ol>',
		);
		expect(md).toBe("[^custom-id]\n\n[^custom-id]: note");
	});

	it("keeps the whole id when the anchor is only the fn prefix", () => {
		const md = htmlToMarkdown(
			'<p><a role="doc-noteref" href="#fn">1</a></p>',
		);
		expect(md).toBe("[^fn]");
	});

	it("renders images with alt text and absolute URLs", () => {
		expect(
			htmlToMarkdown('<p><img src="/img/a.png" alt="תמונה"/></p>'),
		).toBe("![תמונה](https://canonical.example/img/a.png)");
	});

	it("renders ordered and unordered lists", () => {
		const md = htmlToMarkdown("<ul><li>א</li><li>ב</li></ul>");
		expect(md).toBe("- א\n- ב");
		expect(htmlToMarkdown("<ol><li>א</li><li>ב</li></ol>")).toBe("1. א\n2. ב");
	});

	it("renders blockquotes and code blocks", () => {
		expect(htmlToMarkdown("<blockquote><p>ציטוט</p></blockquote>")).toBe(
			"> ציטוט",
		);
		expect(
			htmlToMarkdown('<pre><code class="language-js">x=1</code></pre>'),
		).toBe("```js\nx=1\n```");
	});

	it("converts footnote references and appends definitions", () => {
		const md = htmlToMarkdown(
			'<p>Text<sup><a href="#fn:1">1</a></sup> more.</p>' +
				'<ol class="footnotes"><li id="fn:1"><p>The note.</p></li></ol>',
		);
		expect(md).toBe("Text[^1] more.\n\n[^1]: The note.");
	});

	it("collects footnote definitions nested in a section wrapper", () => {
		expect(
			htmlToMarkdown(
				'<p>t<sup><a href="#fn:1">1</a></sup></p>' +
					'<section class="footnotes"><ol><li id="fn:1">Note</li></ol></section>',
			),
		).toBe("t[^1]\n\n[^1]: Note");
	});

	it("renders tables", () => {
		const md = htmlToMarkdown(
			"<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
		);
		expect(md).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
	});

	it("strips scripts and escapes markdown-structural characters", () => {
		expect(
			htmlToMarkdown("<p>a <script>alert(1)</script>b [x]</p>"),
		).toBe("a b \\[x\\]");
	});

	it("returns empty string for empty input", () => {
		expect(htmlToMarkdown("")).toBe("");
		expect(htmlToMarkdown("   ")).toBe("");
	});

	it("keeps long article content complete (no snippet truncation)", () => {
		const long = Array(500).fill("<p>content</p>").join("");
		const md = htmlToMarkdown(long);
		expect(md.length).toBeGreaterThan(3000);
		expect(md).not.toContain("…");
	});

	it("absolutizes protocol-relative hrefs and keeps fragments", () => {
		expect(htmlToMarkdown('<p><a href="//cdn.example/x">cdn</a></p>')).toBe(
			"[cdn](https://cdn.example/x)",
		);
		expect(htmlToMarkdown('<p><a href="#sec">frag</a></p>')).toBe(
			"[frag](#sec)",
		);
		expect(htmlToMarkdown('<p><a href="rel-page">rel</a></p>')).toBe(
			"[rel](https://canonical.example/rel-page)",
		);
	});

	it("returns the url for blank or whitespace hrefs", () => {
		expect(htmlToMarkdown('<p><a href=" ">t</a></p>')).toBe("[t]()");
	});

	it("skips non-element nodes such as comments", () => {
		expect(htmlToMarkdown("<p>a<!-- note -->b</p>")).toBe("ab");
	});

	it("drops backlinks nested inside sup", () => {
		expect(
			htmlToMarkdown(
				'<p>x<sup><a role="doc-backlink" href="#r">↩</a></sup>y</p>',
			),
		).toBe("xy");
	});

	it("renders anchors without href or with the url as their text", () => {
		expect(htmlToMarkdown("<p><a>plain</a></p>")).toBe("plain");
		expect(
			htmlToMarkdown('<p><a href="https://x.test">https://x.test</a></p>'),
		).toBe("https://x.test");
		expect(htmlToMarkdown('<p><a href="/rel"></a></p>')).toBe(
			"https://canonical.example/rel",
		);
	});

	it("drops media without a src and images without alt", () => {
		expect(htmlToMarkdown("<p><img/></p>")).toBe("");
		expect(htmlToMarkdown('<p><img src="/a.png"/></p>')).toBe(
			"![](https://canonical.example/a.png)",
		);
		expect(htmlToMarkdown("<p><iframe></iframe></p>")).toBe("");
	});

	it("renders a horizontal rule inside an inline context", () => {
		expect(
			htmlToMarkdown("<table><tr><td>a<hr/>b</td></tr></table>"),
		).toBe("| a\n\n---\n\nb |\n| --- |");
	});

	it("ignores non-li children of lists and footnote lists", () => {
		expect(
			htmlToMarkdown("<ul><li>a</li><div>x</div><li>b</li></ul>"),
		).toBe("- a\n- b");
		expect(
			htmlToMarkdown(
				'<p>t<sup><a href="#fn:1">1</a></sup></p>' +
					'<ol class="footnotes"><li>no id</li><span>x</span></ol>',
			),
		).toBe("t[^1]\n\n[^1]: no id");
	});

	it("escapes pipes in cells after backslashes", () => {
		// `\` must escape before `|` — a source `\|` stays literal
		// text, never becomes an escaped-backslash then a separator.
		expect(
			htmlToMarkdown("<table><tr><td>a|b</td><td>c\\|d</td></tr></table>"),
		).toBe("| a\\|b | c\\\\\\|d |\n| --- | --- |");
	});

	it("renders empty and ragged tables", () => {
		expect(htmlToMarkdown("<table></table>")).toBe("");
		expect(htmlToMarkdown("<table><tr></tr><tr><td>1</td></tr></table>")).toBe(
			"| 1 |\n| --- |",
		);
		expect(
			htmlToMarkdown(
				"<table><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr></table>",
			),
		).toBe("| A | B |\n| --- | --- |\n| 1 |  |");
	});

	it("keeps blank lines inside blockquotes", () => {
		expect(htmlToMarkdown("<blockquote><p>a</p><p>b</p></blockquote>")).toBe(
			"> a\n>\n> b",
		);
	});
});
