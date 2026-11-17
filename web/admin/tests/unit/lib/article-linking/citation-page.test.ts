import { describe, expect, it } from "vitest";
import type { TargetCatalogue } from "~/lib/article-linking/catalogue";
import { articleCitationPage } from "~/lib/article-linking/citation-page";

const sourceHash = "a".repeat(64);
const catalogue: TargetCatalogue = {
	perakim: [
		{
			id: 1,
			seferName: "בראשית",
			additionalLetter: null,
			perekInContext: 1,
			pasukCount: 31,
		},
		{
			id: 105,
			seferName: "שמואל",
			additionalLetter: "א",
			perekInContext: 5,
			pasukCount: 20,
		},
		{
			id: 106,
			seferName: "שמואל",
			additionalLetter: "א",
			perekInContext: 6,
			pasukCount: 30,
		},
		{
			id: 205,
			seferName: "שמואל",
			additionalLetter: "ב",
			perekInContext: 5,
			pasukCount: 30,
		},
		{
			id: 206,
			seferName: "שמואל",
			additionalLetter: "ב",
			perekInContext: 6,
			pasukCount: 30,
		},
	],
	authors: [],
	dedications: [],
};
const text = "🙂 פתיחה. בראשית א כו. סוף.";
const quote = "בראשית א כו";
const start = text.indexOf(quote);
const end = start + quote.length;

function read(
	plainText = text,
	options: Partial<Parameters<typeof articleCitationPage>[2]> = {},
) {
	return articleCitationPage(plainText, catalogue, {
		sourceHash,
		cursor: 0,
		limit: 16000,
		...options,
	});
}

describe("bounded source-anchored article citation pages", () => {
	it("resolves Hebrew verse26 without asking the model to interpret the numeral", () => {
		expect(read()).toEqual({
			items: [
				{
					kind: "resolved",
					perekId: 1,
					pasuk: 26,
					pasukTo: 26,
					label: "בראשית א כו",
					quote,
					spanStart: start,
					spanEnd: end,
					sourceHash,
				},
			],
			total: 1,
			nextCursor: null,
		});
	});
	it.each([
		{ cursor: start + 2, limit: 2 },
		{ cursor: start - 1, limit: 2 },
		{ cursor: end - 1, limit: 2 },
		{ cursor: start, limit: quote.length },
	])(
		"preserves full absolute UTF16 anchors when a citation overlaps text page %j",
		(options) => {
			const result = read(text, options);
			expect(result.total).toBe(1);
			expect(result.items[0]).toMatchObject({
				quote,
				spanStart: start,
				spanEnd: end,
				sourceHash,
			});
			expect(
				text.slice(result.items[0].spanStart, result.items[0].spanEnd),
			).toBe(quote);
			expect(result.items[0].spanStart).toBe(10);
		},
	);
	it.each([
		{ cursor: 0, limit: start },
		{ cursor: end, limit: 1 },
		{ cursor: text.length, limit: 100 },
		{ cursor: text.length + 100, limit: 100 },
	])(
		"does not include merely adjacent or absent text-page citations %j",
		(options) => {
			expect(read(text, options)).toEqual({
				items: [],
				total: 0,
				nextCursor: null,
			});
		},
	);
	it("carries explicit ranges as one exact source claim with canonical Hebrew labels", () => {
		const ranged = "ראשית. בראשית א, כו-כח. סוף.";
		const result = read(ranged);
		expect(result.items).toEqual([
			expect.objectContaining({
				kind: "resolved",
				perekId: 1,
				pasuk: 26,
				pasukTo: 28,
				label: "בראשית א כו-כח",
				quote: "בראשית א, כו-כח",
			}),
		]);
		expect(
			ranged.slice(result.items[0].spanStart, result.items[0].spanEnd),
		).toBe(result.items[0].quote);
	});
	it("orders held and resolved spans together without inventing coordinates for ambiguity", () => {
		const mixed = "שמואל ה ז. בראשית א כו. בראשית א לב.";
		const result = read(mixed);
		expect(result.items.map((item) => item.kind)).toEqual([
			"ambiguous",
			"resolved",
			"ambiguous",
		]);
		expect(result.items[1]).toMatchObject({ perekId: 1, pasuk: 26 });
		for (const item of result.items) {
			expect(mixed.slice(item.spanStart, item.spanEnd)).toBe(item.quote);
			expect(item.sourceHash).toBe(sourceHash);
			if (item.kind === "ambiguous") {
				expect(item.reason).toEqual(expect.any(String));
				expect(item).not.toHaveProperty("perekId");
				expect(item).not.toHaveProperty("pasuk");
			}
		}
	});
	it("carries identifiable ambiguity dependencies for the server's current-read receipts", () => {
		expect(read("שמואל ה ז.").items[0]).toMatchObject({
			kind: "ambiguous",
			dependencyPerekIds: [105, 205],
		});
		expect(read("בראשית א לב.").items[0]).toMatchObject({
			kind: "ambiguous",
			dependencyPerekIds: [1],
		});
	});
	it("paginates every overlapping candidate explicitly instead of silently truncating", () => {
		const many = Array.from({ length: 60 }, () => "בראשית א כו.").join("\n");
		const first = read(many);
		const middle = read(many, { citationCursor: 25 });
		const last = read(many, { citationCursor: 50 });
		expect([first.total, middle.total, last.total]).toEqual([60, 60, 60]);
		expect([
			first.items.length,
			middle.items.length,
			last.items.length,
		]).toEqual([25, 25, 10]);
		expect([first.nextCursor, middle.nextCursor, last.nextCursor]).toEqual([
			25,
			50,
			null,
		]);
		const items = [...first.items, ...middle.items, ...last.items];
		expect(new Set(items.map((item) => item.spanStart)).size).toBe(60);
		for (const item of items)
			expect(many.slice(item.spanStart, item.spanEnd)).toBe(item.quote);
		expect(read(many, { citationLimit: 50 }).items).toHaveLength(50);
		expect(read(many, { citationCursor: 60 })).toEqual({
			items: [],
			total: 60,
			nextCursor: null,
		});
	});
	it("candidate pagination is local to the requested text window", () => {
		const later = `${text}\n${text}`;
		const result = read(later, { cursor: text.length, limit: text.length + 1 });
		expect(result.total).toBe(1);
		expect(result.items[0].spanStart).toBe(start + text.length + 1);
		expect(
			read(later, {
				cursor: text.length,
				limit: text.length + 1,
				citationCursor: 1,
			}),
		).toEqual({ items: [], total: 1, nextCursor: null });
	});
	it("binds unchanged quotes to the supplied source revision and shifted absolute offsets", () => {
		const revised = `🙂${text}`;
		const result = read(revised, { sourceHash: "b".repeat(64) });
		expect(result.items[0]).toMatchObject({
			quote,
			sourceHash: "b".repeat(64),
			spanStart: start + 2,
			spanEnd: end + 2,
		});
	});
	it.each(["", "טקסט בלי הפניה מפורשת.", "ספר שאינו מוכר א ב."])(
		"does not invent literal citations from %j",
		(plainText) => {
			expect(read(plainText)).toEqual({
				items: [],
				total: 0,
				nextCursor: null,
			});
		},
	);
	it.each([
		{ cursor: -1 },
		{ cursor: 0.5 },
		{ cursor: Number.POSITIVE_INFINITY },
		{ limit: 0 },
		{ limit: 16001 },
		{ limit: Number.NaN },
		{ citationCursor: -1 },
		{ citationCursor: 0.5 },
		{ citationLimit: 0 },
		{ citationLimit: 51 },
		{ citationLimit: 1.5 },
		{ sourceHash: "private_invalid_hash" },
	])(
		"rejects an unbounded or malformed candidate request without exposing it %j",
		(options) => {
			expect(() => read(text, options)).toThrow(
				/^Invalid article citation page$/,
			);
		},
	);
	it("does not mutate source catalogue metadata", () => {
		const before = structuredClone(catalogue);
		read();
		expect(catalogue).toEqual(before);
	});
});
