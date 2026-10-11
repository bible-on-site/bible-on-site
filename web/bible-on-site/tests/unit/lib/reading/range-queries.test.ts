/**
 * Unit tests for the range-based commentary/article service methods —
 * the shared unit->commentary path used by reading divisions.
 */

jest.mock("../../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../../src/lib/api-client";
import { getArticleSummariesForRanges } from "../../../../src/lib/articles/service";
import {
	getPerushimForRanges,
	getPerushNotesForRanges,
} from "../../../../src/lib/perushim/service";
import type { ScriptureRange } from "../../../../src/lib/reading/contract";

const mockQuery = query as jest.MockedFunction<typeof query>;

/** A cross-perek Masoretic-style range (בראשית א ל - ב ד). */
const CROSS_PEREK: ScriptureRange[] = [
	{
		start: { perekId: 1, pasuk: 30 },
		end: { perekId: 2, pasuk: 4 },
	},
];

/** Haftarah-style ordered ranges with an out-of-order repeat. */
const MULTI_RANGE: ScriptureRange[] = [
	{ start: { perekId: 100, pasuk: 10 }, end: { perekId: 100, pasuk: 12 } },
	{ start: { perekId: 1, pasuk: 1 }, end: { perekId: 1, pasuk: 3 } },
	{ start: { perekId: 100, pasuk: 12 }, end: { perekId: 100, pasuk: 12 } },
];

describe("getPerushimForRanges", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("queries every overlapping perek with inclusive pasuk bounds", async () => {
		mockQuery.mockResolvedValue([]);
		await getPerushimForRanges(CROSS_PEREK);
		const [sql, params] = mockQuery.mock.calls[0];
		// בראשית א has 31 pesukim: the range clips to pasuk 30-31 there.
		expect(sql).toContain("(n.perek_id = ? AND n.pasuk >= ? AND n.pasuk <= ?)");
		expect(params).toEqual([1, 30, 31, 2, 1, 4]);
	});

	it("aggregates one perush appearing across several perakim", async () => {
		mockQuery.mockResolvedValue([
			{
				perush_id: 1,
				perush_name: "Rashi",
				parshan_name: "רש\"י",
				perek_id: 2,
				note_count: 3,
				priority: 100,
			},
			{
				perush_id: 1,
				perush_name: "Rashi",
				parshan_name: "רש\"י",
				perek_id: 1,
				note_count: 5,
				priority: 100,
			},
		]);
		const result = await getPerushimForRanges(CROSS_PEREK);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			id: 1,
			name: "Rashi",
			parshanName: "רש\"י",
			noteCount: 8,
			perekId: 1,
		});
	});

	it("links the perush to the first perek in range order, not canonical order", async () => {
		mockQuery.mockResolvedValue([
			{
				perush_id: 7,
				perush_name: "X",
				parshan_name: "x",
				perek_id: 1,
				note_count: 2,
				priority: 10,
			},
			{
				perush_id: 7,
				perush_name: "X",
				parshan_name: "x",
				perek_id: 100,
				note_count: 4,
				priority: 10,
			},
		]);
		const result = await getPerushimForRanges(MULTI_RANGE);
		// Perek 100 appears first in the ranges even though 1 < 100.
		expect(result[0].perekId).toBe(100);
		expect(result[0].noteCount).toBe(6);
	});

	it("orders by priority then note count like the perek query", async () => {
		mockQuery.mockResolvedValue([
			{
				perush_id: 2,
				perush_name: "B",
				parshan_name: "b",
				perek_id: 1,
				note_count: 9,
				priority: 200,
			},
			{
				perush_id: 1,
				perush_name: "A",
				parshan_name: "a",
				perek_id: 1,
				note_count: 1,
				priority: 100,
			},
		]);
		const result = await getPerushimForRanges(CROSS_PEREK);
		expect(result.map((r) => r.id)).toEqual([1, 2]);
	});

	it("returns empty array when the query fails", async () => {
		mockQuery.mockRejectedValue(new Error("DB error"));
		expect(await getPerushimForRanges(CROSS_PEREK)).toEqual([]);
	});
});

describe("getPerushNotesForRanges", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("passes the perush id plus slice bounds as parameters", async () => {
		mockQuery.mockResolvedValue([]);
		await getPerushNotesForRanges(5, CROSS_PEREK);
		const [sql, params] = mockQuery.mock.calls[0];
		expect(sql).toContain("n.perush_id = ? AND (");
		expect(params).toEqual([5, 1, 30, 31, 2, 1, 4]);
	});

	it("returns notes in range order across perakim, keeping perek anchors", async () => {
		mockQuery.mockResolvedValue([
			{ perek_id: 2, pasuk: 1, note_idx: 0, note_content: "<p>cross</p>" },
			{ perek_id: 1, pasuk: 31, note_idx: 0, note_content: "<p>start</p>" },
		]);
		const result = await getPerushNotesForRanges(5, CROSS_PEREK);
		expect(result.map((n) => [n.perekId, n.pasuk])).toEqual([
			[1, 31],
			[2, 1],
		]);
	});

	it("keeps multi-range reading order over canonical order", async () => {
		// SQL returns canonical perek order; the service re-sorts to the
		// declared range order (perek 100 read before perek 1).
		mockQuery.mockResolvedValue([
			{ perek_id: 1, pasuk: 2, note_idx: 0, note_content: "<p>a</p>" },
			{ perek_id: 100, pasuk: 12, note_idx: 0, note_content: "<p>b</p>" },
		]);
		const result = await getPerushNotesForRanges(5, MULTI_RANGE);
		expect(result.map((n) => n.perekId)).toEqual([100, 1]);
	});

	it("returns empty array on query failure", async () => {
		mockQuery.mockRejectedValue(new Error("timeout"));
		expect(await getPerushNotesForRanges(5, CROSS_PEREK)).toEqual([]);
	});
});

describe("getArticleSummariesForRanges", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("queries distinct overlapping perakim in first-appearance order", async () => {
		mockQuery.mockResolvedValue([]);
		await getArticleSummariesForRanges(MULTI_RANGE);
		const [sql, params] = mockQuery.mock.calls[0];
		expect(sql).toContain("a.perek_id IN (?, ?)");
		// Primary-perek fallback ids first, then the covering-source slice
		// bounds in declared range order (perek 100 before perek 1, and the
		// repeated concluding pasuk kept).
		expect(params).toEqual([100, 1, 100, 10, 12, 1, 1, 3, 100, 12, 12]);
	});

	it("matches verified articles by pasuk-granular covering-source rows", async () => {
		mockQuery.mockResolvedValue([]);
		await getArticleSummariesForRanges(CROSS_PEREK);
		const sql = mockQuery.mock.calls[0][0];
		expect(sql).toContain("FROM tanah_article_covering_source cs");
		expect(sql).toContain("cs.article_id = a.id");
		expect(sql).toContain(
			"(cs.perek_id = ? AND cs.pasuk >= ? AND cs.pasuk <= ?)",
		);
	});

	it("maps rows to article summaries", async () => {
		mockQuery.mockResolvedValue([
			{
				id: 9,
				perek_id: 1,
				author_id: 3,
				abstract: "abs",
				name: "art",
				priority: 1,
				author_name: "author",
			},
		]);
		const result = await getArticleSummariesForRanges(CROSS_PEREK);
		expect(result).toEqual([
			{
				id: 9,
				perekId: 1,
				authorId: 3,
				abstract: "abs",
				name: "art",
				priority: 1,
				authorName: "author",
				authorImageUrl: expect.any(String),
			},
		]);
	});

	it("rejects query failures like the per-perek path", async () => {
		const error = new Error("DB error");
		mockQuery.mockRejectedValue(error);
		await expect(getArticleSummariesForRanges(CROSS_PEREK)).rejects.toBe(
			error,
		);
	});
});
