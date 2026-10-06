import { describe, expect, it } from "vitest";
import { diffHtmlWords, tokenizeHtml } from "~/lib/tanahpedia/html-diff";

describe("tokenizeHtml", () => {
	it("splits into tags, whitespace runs and word runs that rejoin exactly", () => {
		const html = '<p class="a">שלום <b>עולם</b>!</p>';
		const tokens = tokenizeHtml(html);
		expect(tokens.join("")).toBe(html);
		expect(tokens).toContain("<b>");
		expect(tokens).toContain("שלום");
	});

	it("returns an empty array for empty input", () => {
		expect(tokenizeHtml("")).toEqual([]);
	});
});

describe("diffHtmlWords", () => {
	it("returns a single same part for identical input", () => {
		expect(diffHtmlWords("<p>אבג</p>", "<p>אבג</p>")).toEqual([
			{ type: "same", text: "<p>אבג</p>" },
		]);
	});

	it("returns empty for two empty strings", () => {
		expect(diffHtmlWords("", "")).toEqual([]);
	});

	it("marks everything as added when before is empty", () => {
		expect(diffHtmlWords("", "<p>חדש</p>")).toEqual([
			{ type: "add", text: "<p>חדש</p>" },
		]);
	});

	it("marks everything as deleted when after is empty", () => {
		expect(diffHtmlWords("<p>ישן</p>", "")).toEqual([
			{ type: "del", text: "<p>ישן</p>" },
		]);
	});

	it("isolates a single changed word between common prefix and suffix", () => {
		const parts = diffHtmlWords(
			"<p>אברהם אבינו הלך</p>",
			"<p>אברהם אבינו נסע</p>",
		);
		expect(parts).toEqual([
			{ type: "same", text: "<p>אברהם אבינו " },
			{ type: "del", text: "הלך" },
			{ type: "add", text: "נסע" },
			{ type: "same", text: "</p>" },
		]);
	});

	it("keeps shared markup tokens as same when inner text changes", () => {
		const parts = diffHtmlWords("<b>א</b>", "<b>ב</b>");
		expect(parts).toEqual([
			{ type: "same", text: "<b>" },
			{ type: "del", text: "א" },
			{ type: "add", text: "ב" },
			{ type: "same", text: "</b>" },
		]);
	});

	it("merges consecutive parts of the same type", () => {
		const parts = diffHtmlWords("א ב", "א ג ד");
		// " " is shared; "ב" → del, "ג ד" → add
		expect(parts).toEqual([
			{ type: "same", text: "א " },
			{ type: "del", text: "ב" },
			{ type: "add", text: "ג ד" },
		]);
	});

	it("falls back to whole-middle del+add beyond the LCS token cap", () => {
		const a = `${`x ${"a".repeat(4)} `.repeat(1600)}x`;
		const b = `${`x ${"b".repeat(4)} `.repeat(1600)}x`;
		const parts = diffHtmlWords(a, b);
		// prefix "x " same, giant middle del+add, suffix " x" same
		expect(parts[0].type).toBe("same");
		expect(parts.some((p) => p.type === "del")).toBe(true);
		expect(parts.some((p) => p.type === "add")).toBe(true);
		expect(parts[parts.length - 1].type).toBe("same");
	});
});
