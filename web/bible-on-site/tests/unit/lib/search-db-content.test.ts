/**
 * @jest-environment node
 */
jest.mock("@/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "@/lib/api-client";
import {
	perushHitReference,
	searchArticles,
	searchAuthors,
	searchPerushNotes,
} from "@/lib/search/db-content";

const mockQuery = query as jest.MockedFunction<typeof query>;

describe("searchPerushNotes", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("issues a bounded LIKE query and scores results", async () => {
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
			expect.stringContaining("note_content LIKE ?"),
			["%בראשית%"],
		);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("MAX_EXECUTION_TIME"),
			expect.anything(),
		);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.perushName).toBe('רש"י');
		expect(hits[0].entry.perekId).toBe(1);
		expect(hits[0].entry.pasukNum).toBe(1);
	});

	it("ANDs multiple terms into the LIKE query", async () => {
		mockQuery.mockResolvedValue([]);
		await searchPerushNotes("אחד שני", 10);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("note_content LIKE ? AND note_content LIKE ?"),
			["%אחד%", "%שני%"],
		);
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
			expect.stringContaining("a.name LIKE ?"),
			expect.anything(),
		);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.plain).toBe("תוכן ארוך על בראשית");
		expect(hits[0].entry.id).toBe(42);
	});

	it("returns empty for a blank phrase without querying", async () => {
		expect(await searchArticles("---", 10)).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});
});
