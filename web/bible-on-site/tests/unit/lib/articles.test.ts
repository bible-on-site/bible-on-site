/**
 * Unit tests for the articles service
 */

// Mock the api-client module before importing the service
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import { getArticlesByPerekId } from "../../../src/lib/articles";

const mockQuery = query as jest.MockedFunction<typeof query>;

describe("articles service", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// Suppress console.warn during tests
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe("getArticlesByPerekId", () => {
		it("returns mapped articles when query succeeds", async () => {
			const mockRows = [
				{
					id: 1,
					perek_id: 42,
					author_id: 10,
					abstract: "<p>Test abstract</p>",
					name: "Test Article",
					priority: 1,
				},
				{
					id: 2,
					perek_id: 42,
					author_id: 20,
					abstract: null,
					name: "Another Article",
					priority: 2,
				},
			];

			mockQuery.mockResolvedValue(mockRows);

			const result = await getArticlesByPerekId(42);

			expect(mockQuery).toHaveBeenCalledTimes(1);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("SELECT id, perek_id, author_id, abstract, name, priority"),
				[42],
			);

			expect(result).toEqual([
				{
					id: 1,
					perekId: 42,
					authorId: 10,
					abstract: "<p>Test abstract</p>",
					name: "Test Article",
					priority: 1,
				},
				{
					id: 2,
					perekId: 42,
					authorId: 20,
					abstract: null,
					name: "Another Article",
					priority: 2,
				},
			]);
		});

		it("returns empty array when no articles found", async () => {
			mockQuery.mockResolvedValue([]);

			const result = await getArticlesByPerekId(999);

			expect(result).toEqual([]);
		});

		it("returns empty array and logs warning when query fails", async () => {
			const mockError = new Error("Database connection failed");
			mockQuery.mockRejectedValue(mockError);

			const result = await getArticlesByPerekId(1);

			expect(result).toEqual([]);
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch articles for perek 1:",
				"Database connection failed",
			);
		});

		it("handles non-Error rejection gracefully", async () => {
			mockQuery.mockRejectedValue("string error");

			const result = await getArticlesByPerekId(1);

			expect(result).toEqual([]);
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch articles for perek 1:",
				"string error",
			);
		});

		it("queries with correct SQL structure", async () => {
			mockQuery.mockResolvedValue([]);

			await getArticlesByPerekId(100);

			const sqlCall = mockQuery.mock.calls[0][0];
			expect(sqlCall).toContain("FROM tanah_article");
			expect(sqlCall).toContain("WHERE perek_id = ?");
			expect(sqlCall).toContain("ORDER BY priority ASC");
		});
	});
});
