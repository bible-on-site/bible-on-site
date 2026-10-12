/**
 * Unit tests for the perushim service (getPerushimByPerekId, getPerushDetail).
 * Verifies ordering by priority and parshan birth year in detail.
 */

jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import {
	getAllPerushPerekNamePairs,
	getPerushDetail,
	getPerushimByPerekId,
	getPerushimForRanges,
	getPerushNotes,
	getPerushNotesForRanges,
} from "../../../src/lib/perushim";

const mockQuery = query as jest.MockedFunction<typeof query>;

describe("perushim service", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe("getPerushimByPerekId", () => {
		it("returns perushim in query order (priority ASC, note_count DESC)", async () => {
			// Simulate DB returning rows already ordered by ORDER BY p.priority ASC, note_count DESC
			const mockRows = [
				{
					perush_id: 1,
					perush_name: "Ibn Ezra",
					parshan_name: "אבן עזרא",
					note_count: 10,
					priority: 50,
				},
				{
					perush_id: 2,
					perush_name: "Rashi",
					parshan_name: 'רש"י',
					note_count: 5,
					priority: 100,
				},
			];

			mockQuery.mockResolvedValue(mockRows);

			const result = await getPerushimByPerekId(1);

			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("ORDER BY p.priority ASC, note_count DESC"),
				[1],
			);
			expect(result).toEqual([
				{ id: 1, name: "Ibn Ezra", parshanName: "אבן עזרא", noteCount: 10 },
				{ id: 2, name: "Rashi", parshanName: 'רש"י', noteCount: 5 },
			]);
		});

		it("queries with priority in SELECT and GROUP BY", async () => {
			mockQuery.mockResolvedValue([]);

			await getPerushimByPerekId(42);

			const sql = mockQuery.mock.calls[0][0];
			expect(sql).toContain("p.priority AS priority");
			expect(sql).toContain("GROUP BY p.id, p.name, pa.name, p.priority");
		});

		it("returns empty array on Error instance", async () => {
			mockQuery.mockRejectedValue(new Error("DB error"));

			const result = await getPerushimByPerekId(1);

			expect(result).toEqual([]);
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch perushim for perek %d:",
				1,
				"DB error",
			);
		});

		it("returns empty array on non-Error rejection", async () => {
			mockQuery.mockRejectedValue("raw string error");

			const result = await getPerushimByPerekId(1);

			expect(result).toEqual([]);
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch perushim for perek %d:",
				1,
				"raw string error",
			);
		});
	});

	describe("getPerushDetail", () => {
		it("includes parshanBirthYear when DB returns birth_year", async () => {
			mockQuery
				.mockResolvedValueOnce([
					{
						perush_name: "Rashi on Torah",
						parshan_name: 'רש"י',
						parshan_birth_year: 1040,
					},
				])
				.mockResolvedValueOnce([
					{ pasuk: 1, note_idx: 0, note_content: "<p>Comment</p>" },
				]);

			const result = await getPerushDetail(38, 1);

			expect(result).not.toBeNull();
			expect(result?.parshanName).toBe('רש"י');
			expect(result?.parshanBirthYear).toBe(1040);
			expect(result?.notes).toHaveLength(1);
		});

		it("omits parshanBirthYear when DB returns null", async () => {
			mockQuery
				.mockResolvedValueOnce([
					{
						perush_name: "Unknown Commentary",
						parshan_name: "לא ידוע",
						parshan_birth_year: null,
					},
				])
				.mockResolvedValueOnce([]);

			const result = await getPerushDetail(2, 1);

			expect(result).not.toBeNull();
			expect(result?.parshanName).toBe("לא ידוע");
			expect(result).not.toHaveProperty("parshanBirthYear");
		});

		it("returns null when perush not found", async () => {
			mockQuery.mockResolvedValueOnce([]);

			const result = await getPerushDetail(999, 1);

			expect(result).toBeNull();
		});

		it("returns null on Error instance", async () => {
			mockQuery.mockRejectedValue(new Error("timeout"));

			const result = await getPerushDetail(7, 2);

			expect(result).toBeNull();
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch perush detail %d:",
				7,
				"timeout",
			);
		});

		it("returns null on non-Error rejection", async () => {
			mockQuery.mockRejectedValue({ code: "ECONN" });

			const result = await getPerushDetail(7, 2);

			expect(result).toBeNull();
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch perush detail %d:",
				7,
				{ code: "ECONN" },
			);
		});
	});

	describe("getPerushNotes", () => {
		it("returns notes ordered by pasuk and note_idx", async () => {
			mockQuery.mockResolvedValue([
				{ pasuk: 2, note_idx: 0, note_content: "<p>B</p>" },
				{ pasuk: 1, note_idx: 0, note_content: "<p>A</p>" },
			]);

			const result = await getPerushNotes(1, 1);

			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("ORDER BY pasuk ASC, note_idx ASC"),
				[1, 1],
			);
			expect(result).toEqual([
				{ pasuk: 2, noteIdx: 0, noteContent: "<p>B</p>" },
				{ pasuk: 1, noteIdx: 0, noteContent: "<p>A</p>" },
			]);
		});

		it("returns empty array on Error instance", async () => {
			mockQuery.mockRejectedValue(new Error("connection lost"));

			const result = await getPerushNotes(5, 3);

			expect(result).toEqual([]);
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch notes for perush %d perek %d:",
				5,
				3,
				"connection lost",
			);
		});

		it("returns empty array on non-Error rejection", async () => {
			mockQuery.mockRejectedValue(42);

			const result = await getPerushNotes(5, 3);

			expect(result).toEqual([]);
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch notes for perush %d perek %d:",
				5,
				3,
				42,
			);
		});
	});

	describe("getAllPerushPerekNamePairs", () => {
		it("returns mapped pairs from query results", async () => {
			mockQuery.mockResolvedValue([
				{ perek_id: 1, perush_name: 'רש"י' },
				{ perek_id: 1, perush_name: 'רמב"ן' },
				{ perek_id: 2, perush_name: 'רש"י' },
			]);

			const result = await getAllPerushPerekNamePairs();

			expect(result).toEqual([
				{ perekId: 1, perushName: 'רש"י' },
				{ perekId: 1, perushName: 'רמב"ן' },
				{ perekId: 2, perushName: 'רש"י' },
			]);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("SELECT DISTINCT n.perek_id"),
			);
		});

		it("returns empty array on Error instance", async () => {
			mockQuery.mockRejectedValue(new Error("DB error"));

			const result = await getAllPerushPerekNamePairs();

			expect(result).toEqual([]);
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch perush-perek name pairs:",
				"DB error",
			);
		});

		it("returns empty array on non-Error rejection", async () => {
			mockQuery.mockRejectedValue("raw error");

			const result = await getAllPerushPerekNamePairs();

			expect(result).toEqual([]);
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch perush-perek name pairs:",
				"raw error",
			);
		});
	});

	describe("range-based queries", () => {
		// בראשית א (31 pesukim) into בראשית ב — a cross-perek unit slice.
		const crossPerekRanges = [
			{
				start: { perekId: 1, pasuk: 30 },
				end: { perekId: 2, pasuk: 4 },
			},
		];

		describe("getPerushimForRanges", () => {
			it("returns empty without querying for empty ranges", async () => {
				const result = await getPerushimForRanges([]);
				expect(result).toEqual([]);
				expect(mockQuery).not.toHaveBeenCalled();
			});

			it("aggregates one perush across overlapping perakim", async () => {
				mockQuery.mockResolvedValue([
					{
						perush_id: 1,
						perush_name: "Rashi",
						parshan_name: 'רש"י',
						perek_id: 1,
						note_count: 3,
						priority: 100,
					},
					{
						perush_id: 1,
						perush_name: "Rashi",
						parshan_name: 'רש"י',
						perek_id: 2,
						note_count: 4,
						priority: 100,
					},
					{
						perush_id: 2,
						perush_name: "Ibn Ezra",
						parshan_name: "אבן עזרא",
						perek_id: 999, // outside the slices -> falls to last order
						note_count: 1,
						priority: 50,
					},
				]);

				const result = await getPerushimForRanges(crossPerekRanges);

				expect(result).toHaveLength(2);
				// Ibn Ezra wins on priority (50 < 100).
				expect(result[0].id).toBe(2);
				expect(result[0].perekId).toBe(999);
				// Rashi's counts merge; the canonical link is the first
				// perek in range order carrying notes (perek 1).
				expect(result[1]).toEqual(
					expect.objectContaining({
						id: 1,
						perekId: 1,
						noteCount: 7,
					}),
				);
			});

			// Issue #2190: displayed verse totals must count distinct covered
			// pesukim — a pasuk with several notes counts once, while the same
			// pasuk number in another covered perek counts separately
			// (canonical {perekId, pasuk} identity). The query therefore counts
			// DISTINCT pasuk per (perush, perek) group before aggregation.
			it("counts distinct pesukim per covered perek", async () => {
				mockQuery.mockResolvedValue([]);

				await getPerushimForRanges(crossPerekRanges);

				const sql = mockQuery.mock.calls[0][0];
				expect(sql).toContain("COUNT(DISTINCT n.pasuk) AS note_count");
				expect(sql).toContain(
					"GROUP BY p.id, p.name, pa.name, p.priority, n.perek_id",
				);
			});

			it("breaks priority ties by descending note count", async () => {
				mockQuery.mockResolvedValue([
					{
						perush_id: 1,
						perush_name: "A",
						parshan_name: "א",
						perek_id: 1,
						note_count: 2,
						priority: 50,
					},
					{
						perush_id: 2,
						perush_name: "B",
						parshan_name: "ב",
						perek_id: 2,
						note_count: 9,
						priority: 50,
					},
				]);

				const result = await getPerushimForRanges(crossPerekRanges);
				expect(result.map((r) => r.id)).toEqual([2, 1]);
			});

			it("keeps the first perek in range order for the canonical link", async () => {
				// Range jumps from perek 100 to perek 1; a perush appearing
				// in both keeps perek 100 (first in range order).
				mockQuery.mockResolvedValue([
					{
						perush_id: 1,
						perush_name: "Rashi",
						parshan_name: 'רש"י',
						perek_id: 1,
						note_count: 1,
						priority: 100,
					},
					{
						perush_id: 1,
						perush_name: "Rashi",
						parshan_name: 'רש"י',
						perek_id: 100,
						note_count: 2,
						priority: 100,
					},
				]);

				const result = await getPerushimForRanges([
					{
						start: { perekId: 100, pasuk: 5 },
						end: { perekId: 100, pasuk: 7 },
					},
					{
						start: { perekId: 1, pasuk: 1 },
						end: { perekId: 1, pasuk: 2 },
					},
				]);
				expect(result[0].perekId).toBe(100);
				expect(result[0].noteCount).toBe(3);
			});

			it("returns empty array on failure", async () => {
				mockQuery.mockRejectedValue(new Error("DB error"));
				const result = await getPerushimForRanges(crossPerekRanges);
				expect(result).toEqual([]);
				mockQuery.mockRejectedValue("raw error");
				expect(await getPerushimForRanges(crossPerekRanges)).toEqual([]);
			});
		});

		describe("getPerushNotesForRanges", () => {
			it("returns empty without querying for empty ranges", async () => {
				const result = await getPerushNotesForRanges(1, []);
				expect(result).toEqual([]);
				expect(mockQuery).not.toHaveBeenCalled();
			});

			it("orders notes by range order, then pasuk, then note idx", async () => {
				mockQuery.mockResolvedValue([
					// DB orders by perek_id ASC; range order is 100 before 1.
					{ perek_id: 1, pasuk: 1, note_idx: 0, note_content: "note-a" },
					{
						perek_id: 100,
						pasuk: 7,
						note_idx: 1,
						note_content: "note-c",
					},
					{
						perek_id: 100,
						pasuk: 7,
						note_idx: 0,
						note_content: "note-b",
					},
					// Rows for perakim outside the slices sort last, stable.
					{ perek_id: 500, pasuk: 1, note_idx: 0, note_content: "x-1" },
					{ perek_id: 501, pasuk: 1, note_idx: 0, note_content: "x-2" },
				]);

				const result = await getPerushNotesForRanges(1, [
					{
						start: { perekId: 100, pasuk: 5 },
						end: { perekId: 100, pasuk: 8 },
					},
					{
						start: { perekId: 1, pasuk: 1 },
						end: { perekId: 1, pasuk: 2 },
					},
				]);

				expect(result.map((n) => n.noteContent)).toEqual([
					"note-b",
					"note-c",
					"note-a",
					"x-1",
					"x-2",
				]);
				expect(result[0].perekId).toBe(100);
			});

			it("returns empty array on failure", async () => {
				mockQuery.mockRejectedValue(new Error("DB error"));
				const result = await getPerushNotesForRanges(1, crossPerekRanges);
				expect(result).toEqual([]);
				mockQuery.mockRejectedValue("raw error");
				expect(await getPerushNotesForRanges(1, crossPerekRanges)).toEqual([]);
			});
		});
	});
});
