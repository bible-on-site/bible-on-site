/**
 * @jest-environment node
 */
jest.mock("@/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "@/lib/api-client";
import {
	perushHitReference,
	phraseRegexp,
	searchArticles,
	searchAuthors,
	searchPerushNotes,
	termRegexp,
} from "@/lib/search/db-content";

const mockQuery = query as jest.MockedFunction<typeof query>;

/**
 * Compile a generated pattern the same way MySQL's ICU engine reads it.
 * The fragments use only constructs shared by both engines (\p{M}/\p{L}/
 * \p{N} classes, non-capturing groups, anchors).
 */
function jsRegexp(pattern: string): RegExp {
	return new RegExp(pattern, "u");
}

describe("termRegexp", () => {
	it("matches characters the normalizer erases inside a term", () => {
		const pattern = jsRegexp(termRegexp("שליטא"));
		expect(pattern.test('הרב שליט"א לוי')).toBe(true); // gershayim
		expect(pattern.test("שְׁלִיטָא")).toBe(true); // niqqud/taamim
		expect(pattern.test("שלי<b>טא</b>")).toBe(true); // inline markup
		expect(pattern.test("שליט&quot;א")).toBe(true); // entity
	});

	it("does not let a term skip across a real word boundary", () => {
		const pattern = jsRegexp(termRegexp("את"));
		expect(pattern.test("אבא תורה")).toBe(false); // space is a boundary
		expect(pattern.test("אמר-תורה")).toBe(false); // punctuation too
		expect(pattern.test('א"ת בראשית')).toBe(true); // quotes are erased
	});
});

describe("phraseRegexp", () => {
	it("requires the phrase as consecutive whole words", () => {
		const pattern = jsRegexp(phraseRegexp(["בראשית", "ברא"]));
		expect(pattern.test("דבור בראשית ברא אלהים")).toBe(true);
		expect(pattern.test("בְּרֵאשִׁית בָּרָא")).toBe(true);
		expect(pattern.test("בראשית אלה ברא")).toBe(false); // not adjacent
		expect(pattern.test("נבראשית ברא")).toBe(false); // mid-word start
		expect(pattern.test("בראשית בראים")).toBe(false); // mid-word end
	});

	it("bounds a single term by word edges or string edges", () => {
		const pattern = jsRegexp(phraseRegexp(["את"]));
		expect(pattern.test("את")).toBe(true);
		expect(pattern.test("אבא תורה")).toBe(false);
		expect(pattern.test("לאת")).toBe(false);
		expect(pattern.test("אתי")).toBe(false);
	});
});

describe("searchPerushNotes", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("issues a bounded ranked REGEXP query and scores results", async () => {
		mockQuery.mockResolvedValue([
			{
				perush_id: 23,
				perush_name: "רש\"י",
				perek_id: 1,
				pasuk: 1,
				note_content: "<p>בראשית - לשון בראייה</p>",
			},
			{
				perush_id: 23,
				perush_name: "רש\"י",
				perek_id: 1,
				pasuk: 2,
				note_content: "<p>טקסט אחר לגמרי</p>",
			},
		]);
		const hits = await searchPerushNotes("בראשית", 10);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("REGEXP_LIKE(n.note_content, ?, 'i')"),
			[termRegexp("בראשית"), phraseRegexp(["בראשית"])],
		);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("MAX_EXECUTION_TIME"),
			expect.anything(),
		);
		// Whole-word candidates are ranked before the row cap.
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("ORDER BY REGEXP_LIKE"),
			expect.anything(),
		);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.perushName).toBe('רש"י');
		expect(hits[0].entry.perekId).toBe(1);
		expect(hits[0].entry.pasukNum).toBe(1);
	});

	it("ANDs multiple terms into the candidate query", async () => {
		mockQuery.mockResolvedValue([]);
		await searchPerushNotes("אחד שני", 10);
		const [sql, params] = mockQuery.mock.calls[0];
		// Two candidate predicates (one per term) plus one ORDER BY rank.
		expect(sql.match(/REGEXP_LIKE\(n\.note_content/g)).toHaveLength(3);
		expect(params).toEqual([
			termRegexp("אחד"),
			termRegexp("שני"),
			phraseRegexp(["אחד", "שני"]),
		]);
	});

	it("dedupes to the best fragment per perush/perek/pasuk", async () => {
		mockQuery.mockResolvedValue([
			{
				perush_id: 23,
				perush_name: "רש\"י",
				perek_id: 1,
				pasuk: 1,
				note_content: "מלים על בראשית ועוד בראשית",
			},
			{
				perush_id: 23,
				perush_name: "רש\"י",
				perek_id: 1,
				pasuk: 1,
				note_content: "טקסט נוסף בראשית",
			},
		]);
		const hits = await searchPerushNotes("בראשית", 10);
		expect(hits).toHaveLength(1);
		expect(hits[0].score).toBeGreaterThan(0);
	});

	it("returns empty for a blank phrase without querying", async () => {
		const hits = await searchPerushNotes("---", 10);
		expect(hits).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it("builds a canonical perush reference", () => {
		const ref = perushHitReference({
			perushId: 23,
			perushName: "רש\"י",
			perekId: 1,
			pasukNum: 1,
			noteContent: "",
			plain: "",
		});
		expect(ref).toBe('רש"י בראשית א א');
	});
});

describe("searchAuthors", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("matches authors by name with a slug for the link", async () => {
		mockQuery.mockResolvedValue([
			{ id: 7, name: 'הרב שליט"א לוי', details: "רב ומחבר" },
		]);
		const hits = await searchAuthors("שליטא", 10);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.slug).toBe(encodeURIComponent("הרב שליטא לוי"));
		expect(hits[0].score).toBeGreaterThan(0);
	});

	it("ORs name and details per term and ranks word matches first", async () => {
		mockQuery.mockResolvedValue([]);
		await searchAuthors("לוי", 10);
		const [sql, params] = mockQuery.mock.calls[0];
		expect(sql).toContain(
			"REGEXP_LIKE(name, ?, 'i') OR REGEXP_LIKE(details, ?, 'i')",
		);
		expect(sql).toContain(
			"ORDER BY REGEXP_LIKE(name, ?, 'i') DESC, REGEXP_LIKE(details, ?, 'i') DESC",
		);
		expect(params).toEqual([
			termRegexp("לוי"),
			termRegexp("לוי"),
			phraseRegexp(["לוי"]),
			phraseRegexp(["לוי"]),
		]);
	});

	it("matches authors without details and orders equal scores by id", async () => {
		mockQuery.mockResolvedValue([
			{ id: 2, name: "רב לוי", details: null },
			{ id: 3, name: "לוי הראשון", details: null },
			{ id: 1, name: "רב לוי", details: null },
		]);
		const hits = await searchAuthors("לוי", 10);
		expect(hits).toHaveLength(3);
		// The two identical names tie on score and fall back to id order.
		const tied = hits.filter((hit) => hit.entry.name === "רב לוי");
		expect(tied.map((hit) => hit.entry.id)).toEqual([1, 2]);
	});

	it("returns empty for a blank phrase without querying", async () => {
		expect(await searchAuthors("---", 10)).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});
});

describe("searchArticles", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("matches article names and strips HTML before scoring", async () => {
		mockQuery.mockResolvedValue([
			{
				id: 42,
				perek_id: 1,
				name: "מאמר על בראשית",
				author_name: "הרב לוי",
				content: "<p>תוכן ארוך על בראשית</p>",
				abstract: null,
			},
		]);
		const hits = await searchArticles("בראשית", 10);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("REGEXP_LIKE(a.name, ?, 'i')"),
			expect.anything(),
		);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.plain).toBe("תוכן ארוך על בראשית");
		expect(hits[0].entry.id).toBe(42);
	});

	it("keeps an abstract-only match even when content is unrelated", async () => {
		mockQuery.mockResolvedValue([
			{
				id: 7,
				perek_id: 1,
				name: "מבוא",
				author_name: "הרב לוי",
				content: "דברי פתיחה בלי קשר",
				abstract: "<p>על בראשית</p>",
			},
		]);
		const hits = await searchArticles("בראשית", 10);
		expect(hits).toHaveLength(1);
		// The snippet comes from the field that supplied the match.
		expect(hits[0].entry.plain).toBe("על בראשית");
		expect(hits[0].score).toBeGreaterThan(0);
	});

	it("falls back to the abstract when content is missing", async () => {
		mockQuery.mockResolvedValue([
			{
				id: 5,
				perek_id: 1,
				name: "מאמר זר",
				author_name: "הרב לוי",
				content: null,
				abstract: "<p>תקציר על בראשית</p>",
			},
		]);
		const hits = await searchArticles("בראשית", 10);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.plain).toBe("תקציר על בראשית");
	});

	it("drops an article with no searchable text", async () => {
		mockQuery.mockResolvedValue([
			{
				id: 6,
				perek_id: 1,
				name: "מאמר",
				author_name: "הרב",
				content: null,
				abstract: null,
			},
		]);
		const hits = await searchArticles("בראשית", 10);
		expect(hits).toHaveLength(0);
	});

	it("returns empty for a blank phrase without querying", async () => {
		expect(await searchArticles("---", 10)).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});
});
