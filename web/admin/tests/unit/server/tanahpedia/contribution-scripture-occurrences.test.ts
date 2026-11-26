import { describe, expect, it } from "vitest";
import {
	createScriptureOccurrenceIndex,
	packScriptureCorpus,
} from "~/server/tanahpedia/contribution-scripture-occurrences.server";

const qri = (value: string) => ({ type: "qri", value });
const ktiv = (value: string) => ({ type: "ktiv", value });
const perek = (...verses: ReturnType<typeof qri>[][]) => ({
	pesukim: verses.map((segments) => ({ segments })),
});

const chapters = packScriptureCorpus([
	{
		name: "שמות",
		perekFrom: 51,
		perakim: [
			perek(
				[
					qri("וַיָּבֹאוּ"),
					qri("מִצְרַיִם"),
					{ type: "stuma", value: "" },
					qri("מִצְרַיִם"),
				],
				[qri("בְּיַם־"), qri("סוּף"), qri("עַל־"), qri("יָם"), qri("סוּף")],
				[ktiv("מצרים"), qri("מִצְרַיִם"), qri("מִצְרָיְמָה")],
			),
		],
	},
	{
		name: "מלכים",
		perekFrom: 288,
		perakim: [],
		additionals: [
			{ name: "מלכים ב", perekFrom: 310, perakim: [perek([qri("וּבְמִצְרַיִם")])] },
		],
	},
]);
const index = createScriptureOccurrenceIndex(chapters);

describe("canonical scripture occurrence candidates", () => {
	it("keeps the raw indices, all distinct spellings, and the canonical split-book citation", () => {
		const first = index.search({
			spellings: ["מצרים", "מִצְרַיִם", "מצרימה"],
			limit: 2,
		});
		expect(first).toMatchObject({
			total: 6,
			nextCursor: 2,
			items: [
				{
					perekId: 51,
					pasukNumber: 1,
					segmentStart: 1,
					segmentEnd: 1,
					text: "מִצְרַיִם",
				},
				{
					perekId: 51,
					pasukNumber: 1,
					segmentStart: 3,
					segmentEnd: 3,
					text: "מִצְרַיִם",
				},
			],
		});
		const last = index.search({ spellings: ["מצרים", "מצרימה"], cursor: 5 });
		expect(last).toEqual({
			total: 6,
			nextCursor: null,
			items: [
				{
					perekId: 310,
					pasukNumber: 1,
					segmentStart: 0,
					segmentEnd: 0,
					text: "וּבְמִצְרַיִם",
					citation: "מלכים ב א א",
					verseText: "וּבְמִצְרַיִם",
				},
			],
		});
		expect(
			index.search({ spellings: ["מצרים", "מצרימה"], book: "שמות" }).total,
		).toBe(5);
		expect(index.search({ spellings: ["מצרים"], cursor: 100 }).items).toEqual(
			[],
		);
		expect(index.search({ spellings: ["כנען"] }).total).toBe(0);
	});

	it("deduplicates phrase variants while respecting maqaf and structural segments", () => {
		const page = index.search({ spellings: ["ים סוף", "ים-סוף", "ים־סוף"] });
		expect(
			page.items.map(({ segmentStart, segmentEnd, text }) => [
				segmentStart,
				segmentEnd,
				text,
			]),
		).toEqual([
			[0, 1, "בְּיַם־סוּף"],
			[3, 4, "יָם סוּף"],
		]);
		expect(index.search({ spellings: ["מצרים מצרים"] }).total).toBe(0);
	});

	it("rejects unsupported filters and malformed requests", () => {
		expect(() => index.search({ spellings: [] })).toThrow(/1-16/);
		expect(() => index.search({ spellings: ["Egypt"] })).toThrow(
			/Hebrew words/,
		);
		expect(() => index.search({ spellings: ["-"] })).toThrow(/1-8/);
		expect(() =>
			index.search({ spellings: ["מצרים"], book: "לא קיים" }),
		).toThrow(/book/);
		expect(() => index.search({ spellings: ["מצרים"], limit: 0 })).toThrow(
			/page/,
		);
		expect(() => index.search({ spellings: ["מצרים"], cursor: -1 })).toThrow(
			/page/,
		);
	});
});

describe("reviewed scripture anchor validation", () => {
	const occurrence = {
		perekId: 51,
		pasukNumber: 1,
		segmentStart: 1,
		segmentEnd: 1,
		text: "מִצְרַיִם",
	};

	it("recomputes the citation from the canonical location and preserves the exact text", () => {
		expect(index.validate([occurrence])).toEqual([
			{ ...occurrence, citation: "שמות א א" },
		]);
	});

	it("rejects out of bounds anchors, stale text, invalid spans, and duplicates", () => {
		for (const change of [
			{ perekId: 999 },
			{ pasukNumber: 0 },
			{ pasukNumber: 11 },
			{ segmentStart: -1 },
			{ segmentStart: 1.5 },
			{ segmentEnd: 0 },
			{ segmentEnd: 2 },
			{ segmentEnd: 98 },
			{ segmentEnd: Infinity },
			{ text: "" },
			{ text: "מצרים" },
			{ text: "מִצְרַיִם " },
		]) {
			expect(() => index.validate([{ ...occurrence, ...change }])).toThrow(
				/canonical word span/,
			);
		}
		expect(() => index.validate([occurrence, occurrence])).toThrow(/Duplicate/);
		expect(() => index.validate(Array(1601).fill(occurrence))).toThrow(/1600/);
		expect(() =>
			index.validate([
				{
					...occurrence,
					pasukNumber: 3,
					segmentStart: 0,
					segmentEnd: 1,
					text: "מצרים מִצְרַיִם",
				},
			]),
		).toThrow(/canonical word span/);
	});
});

it("pages canonical pointed chapter text by verse without rewriting maqaf or adding ktiv alternatives", () => {
	expect(index.readChapter(51, 1, 1)).toEqual({
		perekId: 51,
		book: "שמות",
		chapter: 1,
		citation: "שמות א",
		items: [
			{ pasukNumber: 2, citation: "שמות א ב", text: "בְּיַם־סוּף עַל־יָם סוּף" },
		],
		total: 3,
		nextCursor: 2,
	});
	expect(index.readChapter(51, 2)).toMatchObject({
		items: [{ pasukNumber: 3, text: "מִצְרַיִם מִצְרָיְמָה" }],
		nextCursor: null,
	});
	expect(() => index.readChapter(999)).toThrow(/canonical Scripture chapter/);
	expect(() => index.readChapter(51, 0, 26)).toThrow(/page/);
});
