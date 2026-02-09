/**
 * Unit tests for the perushim service (getPerushimByPerekId, getPerushDetail).
 * Verifies ordering by priority and parshan birth year in detail.
 */

jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import {
	getPerushDetail,
	getPerushimByPerekId,
	getPerushNotes,
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
					parshan_name: "רש״י",
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
				{ id: 2, name: "Rashi", parshanName: "רש״י", noteCount: 5 },
			]);
		});

		it("queries with priority in SELECT and GROUP BY", async () => {
			mockQuery.mockResolvedValue([]);

			await getPerushimByPerekId(42);

			const sql = mockQuery.mock.calls[0][0];
			expect(sql).toContain("p.priority AS priority");
			expect(sql).toContain("GROUP BY p.id, p.name, pa.name, p.priority");
		});

		it("returns empty array on error", async () => {
			mockQuery.mockRejectedValue(new Error("DB error"));

			const result = await getPerushimByPerekId(1);

			expect(result).toEqual([]);
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch perushim for perek 1:",
				"DB error",
			);
		});
	});

	describe("getPerushDetail", () => {
		it("includes parshanBirthYear when DB returns birth_year", async () => {
			mockQuery
				.mockResolvedValueOnce([
					{
						perush_name: "Rashi on Torah",
						parshan_name: "רש״י",
						parshan_birth_year: 1040,
					},
				])
				.mockResolvedValueOnce([
					{ pasuk: 1, note_idx: 0, note_content: "<p>Comment</p>" },
				]);

			const result = await getPerushDetail(38, 1);

			expect(result).not.toBeNull();
			expect(result?.parshanName).toBe("רש״י");
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
	});
});
