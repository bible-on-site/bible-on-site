import { describe, expect, it } from "vitest";
import { extractPlainText, locateQuote } from "~/lib/article-linking/html-text";

describe("extractPlainText", () => {
	it("strips tags and turns block boundaries into newlines", () => {
		const text = extractPlainText(
			"<p>שורה ראשונה</p><div><b>מודגש</b></div><p>אחרונה</p>",
		);
		expect(text).toBe("שורה ראשונה\n\nמודגש\n\nאחרונה");
	});

	it("drops script and style interiors entirely", () => {
		const text = extractPlainText(
			"<p>לפני</p><script>alert(1)</script><style>body{}</style><p>אחרי</p>",
		);
		expect(text).toBe("לפני\n\nאחרי");
	});

	it("cannot re-form a tag from nested angle brackets (CodeQL regression)", () => {
		// `<<script>script>` used to leave `<script>` behind after a one-pass
		// regex strip. The scanner swallows everything until the first `>`.
		const text = extractPlainText("a<<script>script>b");
		expect(text).toBe("ascript>b");
		expect(text).not.toContain("<script");
	});

	it("leaves stray closing brackets and unmatched markup as text", () => {
		expect(extractPlainText("x>y <z w>q")).toBe("x>y q");
	});

	it("decodes the common entities", () => {
		expect(extractPlainText("a&amp;b &lt;c&gt; &quot;ד&quot; &#39;ה&#39;")).toBe(
			'a&b <c> "ד" \'ה\'',
		);
	});

	it("leaves unrecognized numeric entities untouched", () => {
		expect(extractPlainText("x&#034;y")).toBe("x&#034;y");
	});

	it("collapses whitespace without touching Hebrew content", () => {
		expect(extractPlainText("<p>א    ב\t\tג</p>")).toBe("א ב ג");
	});
});

describe("locateQuote", () => {
	it("returns the span of an exact quote", () => {
		expect(locateQuote("אבגדה", "בג")).toEqual({ spanStart: 1, spanEnd: 3 });
	});

	it("returns null when the quote is absent", () => {
		expect(locateQuote("אבג", "ד")).toBeNull();
	});
});
