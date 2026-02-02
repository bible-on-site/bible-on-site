/**
 * Unit tests for the articles service
 */

// Mock the api-client module before importing the service
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

// Mock the authors service to avoid S3 availability checks
jest.mock("../../../src/lib/authors/service", () => ({
	getAuthorImageUrl: jest.fn((authorId: number) => `https://test-bucket.s3.test-region.amazonaws.com/authors/high-res/${authorId}.jpg`),
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
		it("returns mapped articles with author info when query succeeds", async () => {
			const mockRows = [
				{
					id: 1,
					perek_id: 42,
					author_id: 10,
					abstract: "<p>Test abstract</p>",
					name: "Test Article",
					priority: 1,
					author_name: "הרב ישראל",
				},
				{
					id: 2,
					perek_id: 42,
					author_id: 20,
					abstract: null,
					name: "Another Article",
					priority: 2,
					author_name: "הרב יעקב",
				},
			];

			mockQuery.mockResolvedValue(mockRows);

			const result = await getArticlesByPerekId(42);

			expect(mockQuery).toHaveBeenCalledTimes(1);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority"),
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
					authorName: "הרב ישראל",
					authorImageUrl: "https://test-bucket.s3.test-region.amazonaws.com/authors/high-res/10.jpg",
				},
				{
					id: 2,
					perekId: 42,
					authorId: 20,
					abstract: null,
					name: "Another Article",
					priority: 2,
					authorName: "הרב יעקב",
					authorImageUrl: "https://test-bucket.s3.test-region.amazonaws.com/authors/high-res/20.jpg",
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

		it("queries with correct SQL structure including author JOIN", async () => {
			mockQuery.mockResolvedValue([]);

			await getArticlesByPerekId(100);

			const sqlCall = mockQuery.mock.calls[0][0];
			expect(sqlCall).toContain("FROM tanah_article a");
			expect(sqlCall).toContain("JOIN tanah_author au ON a.author_id = au.id");
			expect(sqlCall).toContain("WHERE a.perek_id = ?");
			expect(sqlCall).toContain("ORDER BY a.priority ASC");
			expect(sqlCall).toContain("au.name AS author_name");
		});
	});
});
