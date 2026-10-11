/**
 * Unit tests for the articles service
 */

// Mock the api-client module before importing the service
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

// Mock the authors service to avoid S3 availability checks
jest.mock("../../../src/lib/authors/service", () => ({
	getAuthorImageUrl: jest.fn(
		(authorId: number) =>
			`https://test-bucket.s3.test-region.amazonaws.com/authors/high-res/${authorId}.jpg`,
	),
}));

import { query } from "../../../src/lib/api-client";
import {
	getAllArticleIdsByPerek,
	getAllArticlePerekIdPairs,
	getArticleById,
	getArticleSummariesByPerekId,
	getArticleSummariesForRanges,
	getArticlesByPerekId,
} from "../../../src/lib/articles";

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
					content: "<p>Full content</p>",
					name: "Test Article",
					priority: 1,
					author_name: "הרב ישראל",
				},
				{
					id: 2,
					perek_id: 42,
					author_id: 20,
					abstract: null,
					content: null,
					name: "Another Article",
					priority: 2,
					author_name: "הרב יעקב",
				},
			];

			mockQuery.mockResolvedValue(mockRows);

			const result = await getArticlesByPerekId(42);

			expect(mockQuery).toHaveBeenCalledTimes(1);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining(
					"a.id, a.perek_id, a.author_id, a.abstract, a.content, a.name, a.priority",
				),
				[42],
			);

			expect(result).toEqual([
				{
					id: 1,
					perekId: 42,
					authorId: 10,
					abstract: "<p>Test abstract</p>",
					content: "<p>Full content</p>",
					name: "Test Article",
					priority: 1,
					authorName: "הרב ישראל",
					authorImageUrl:
						"https://test-bucket.s3.test-region.amazonaws.com/authors/high-res/10.jpg",
				},
				{
					id: 2,
					perekId: 42,
					authorId: 20,
					abstract: null,
					content: null,
					name: "Another Article",
					priority: 2,
					authorName: "הרב יעקב",
					authorImageUrl:
						"https://test-bucket.s3.test-region.amazonaws.com/authors/high-res/20.jpg",
				},
			]);
		});

		it("returns empty array when no articles found", async () => {
			mockQuery.mockResolvedValue([]);

			const result = await getArticlesByPerekId(999);

			expect(result).toEqual([]);
		});

		it("rejects and logs database failures without caching empty content", async () => {
			const mockError = new Error("Database connection failed");
			mockQuery.mockRejectedValue(mockError);

			await expect(getArticlesByPerekId(1)).rejects.toBe(mockError);
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch articles for perek 1:",
				"Database connection failed",
			);
		});

		it("propagates non-Error rejections without caching them", async () => {
			mockQuery.mockRejectedValue("string error");

			await expect(getArticlesByPerekId(1)).rejects.toBe("string error");
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
			expect(sqlCall).toContain("a.perek_id BETWEEN 1 AND 929");
			expect(sqlCall).toContain("ORDER BY a.priority ASC");
			expect(sqlCall).toContain("au.name AS author_name");
		});
	});

	describe("getArticleSummariesByPerekId", () => {
		it("returns summaries without content field", async () => {
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
			];

			mockQuery.mockResolvedValue(mockRows);

			const result = await getArticleSummariesByPerekId(42);

			expect(result).toEqual([
				{
					id: 1,
					perekId: 42,
					authorId: 10,
					abstract: "<p>Test abstract</p>",
					name: "Test Article",
					priority: 1,
					authorName: "הרב ישראל",
					authorImageUrl:
						"https://test-bucket.s3.test-region.amazonaws.com/authors/high-res/10.jpg",
				},
			]);
			expect(result[0]).not.toHaveProperty("content");
		});

		it("only surfaces articles in the 929 chapter range", async () => {
			mockQuery.mockResolvedValue([]);

			await getArticleSummariesByPerekId(1);

			expect(mockQuery.mock.calls[0][0]).toContain(
				"a.perek_id BETWEEN 1 AND 929",
			);
		});

		it("does not select content column in SQL", async () => {
			mockQuery.mockResolvedValue([]);

			await getArticleSummariesByPerekId(1);

			const sqlCall = mockQuery.mock.calls[0][0];
			expect(sqlCall).not.toContain("a.content");
			expect(sqlCall).toContain("a.abstract");
			expect(sqlCall).toContain("a.name");
		});

		it("rejects database failures instead of caching an empty list", async () => {
			mockQuery.mockRejectedValue(new Error("DB error"));

			await expect(getArticleSummariesByPerekId(1)).rejects.toThrow("DB error");
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch article summaries for perek %d:",
				1,
				"DB error",
			);
		});

		it("propagates non-Error rejections without caching them", async () => {
			mockQuery.mockRejectedValue("string error");

			await expect(getArticleSummariesByPerekId(1)).rejects.toBe(
				"string error",
			);
		});
	});

	describe("getAllArticlePerekIdPairs", () => {
		it("returns mapped article-perek pairs when query succeeds", async () => {
			const mockRows = [
				{ id: 1, perek_id: 10 },
				{ id: 2, perek_id: 20 },
				{ id: 3, perek_id: 20 },
			];

			mockQuery.mockResolvedValue(mockRows);

			const result = await getAllArticlePerekIdPairs();

			expect(result).toEqual([
				{ articleId: 1, perekId: 10 },
				{ articleId: 2, perekId: 20 },
				{ articleId: 3, perekId: 20 },
			]);
		});

		it("returns empty array when no articles exist", async () => {
			mockQuery.mockResolvedValue([]);

			const result = await getAllArticlePerekIdPairs();

			expect(result).toEqual([]);
		});

		it("rejects database failures without publishing missing URLs", async () => {
			mockQuery.mockRejectedValue(new Error("Database connection failed"));

			await expect(getAllArticlePerekIdPairs()).rejects.toThrow(
				"Database connection failed",
			);
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch article-perek pairs:",
				"Database connection failed",
			);
		});

		it("propagates non-Error rejections without caching them", async () => {
			mockQuery.mockRejectedValue("string error");

			await expect(getAllArticlePerekIdPairs()).rejects.toBe("string error");
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch article-perek pairs:",
				"string error",
			);
		});

		it("queries with correct SQL ordering", async () => {
			mockQuery.mockResolvedValue([]);

			await getAllArticlePerekIdPairs();

			const sqlCall = mockQuery.mock.calls[0][0];
			expect(sqlCall).toContain("SELECT id, perek_id FROM tanah_article");
			expect(sqlCall).toContain("perek_id BETWEEN 1 AND 929");
			expect(sqlCall).toContain("ORDER BY perek_id ASC, id ASC");
		});
	});

	describe("getAllArticleIdsByPerek", () => {
		it("groups multiple articles per chapter while preserving database order", async () => {
			mockQuery.mockResolvedValue([
				{ id: 4, perek_id: 1 },
				{ id: 7, perek_id: 1 },
				{ id: 9, perek_id: 929 },
			]);

			expect(await getAllArticleIdsByPerek()).toEqual(
				new Map([
					[1, [4, 7]],
					[929, [9]],
				]),
			);
			const sql = mockQuery.mock.calls[0][0];
			expect(sql).toContain("perek_id BETWEEN 1 AND 929");
			expect(sql).not.toContain("distributable");
		});

		it("returns an empty map for an empty corpus", async () => {
			mockQuery.mockResolvedValue([]);
			expect(await getAllArticleIdsByPerek()).toEqual(new Map());
		});

		it.each([new Error("DB error"), "connection lost"])(
			"rejects database failure %s instead of publishing missing URLs",
			async (error) => {
				mockQuery.mockRejectedValue(error);
				await expect(getAllArticleIdsByPerek()).rejects.toBe(error);
			},
		);
	});

	describe("getArticleById", () => {
		it("returns mapped article when found", async () => {
			const mockRow = {
				id: 5,
				perek_id: 42,
				author_id: 10,
				abstract: "<p>Abstract</p>",
				content: "<p>Content</p>",
				name: "Test Article",
				priority: 1,
				author_name: "הרב ישראל",
			};

			mockQuery.mockResolvedValue([mockRow]);

			const result = await getArticleById(5);

			expect(result).toEqual({
				id: 5,
				perekId: 42,
				authorId: 10,
				abstract: "<p>Abstract</p>",
				content: "<p>Content</p>",
				name: "Test Article",
				priority: 1,
				authorName: "הרב ישראל",
				authorImageUrl:
					"https://test-bucket.s3.test-region.amazonaws.com/authors/high-res/10.jpg",
			});
		});

		it("returns null when article not found", async () => {
			mockQuery.mockResolvedValue([]);

			const result = await getArticleById(999);

			expect(result).toBeNull();
		});

		it("rejects and logs database errors", async () => {
			mockQuery.mockRejectedValue(new Error("DB error"));

			await expect(getArticleById(1)).rejects.toThrow("DB error");
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch article 1:",
				"DB error",
			);
		});

		it("propagates non-Error rejections without caching them", async () => {
			mockQuery.mockRejectedValue("string error");

			await expect(getArticleById(1)).rejects.toBe("string error");
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch article 1:",
				"string error",
			);
		});

		it("queries with correct SQL structure", async () => {
			mockQuery.mockResolvedValue([]);

			await getArticleById(42);

			const sqlCall = mockQuery.mock.calls[0][0];
			expect(sqlCall).toContain("FROM tanah_article a");
			expect(sqlCall).toContain("JOIN tanah_author au ON a.author_id = au.id");
			expect(sqlCall).toContain("WHERE a.id = ?");
			expect(sqlCall).toContain("a.perek_id BETWEEN 1 AND 929");
			expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [42]);
		});
	});

	describe("getArticleSummariesForRanges", () => {
		// בראשית א into בראשית ב — a cross-perek unit slice.
		const crossPerekRanges = [
			{
				start: { perekId: 1, pasuk: 30 },
				end: { perekId: 2, pasuk: 4 },
			},
		];

		it("returns empty without querying for empty ranges", async () => {
			const result = await getArticleSummariesForRanges([]);
			expect(result).toEqual([]);
			expect(mockQuery).not.toHaveBeenCalled();
		});

		it("queries every overlapping perek via IN", async () => {
			mockQuery.mockResolvedValue([]);
			await getArticleSummariesForRanges(crossPerekRanges);
			const [sql, params] = mockQuery.mock.calls[0];
			expect(sql).toContain("a.perek_id IN (?, ?)");
			expect(params).toEqual([1, 2]);
		});

		it("maps rows to summaries", async () => {
			mockQuery.mockResolvedValue([
				{
					id: 7,
					perek_id: 2,
					author_id: 10,
					abstract: "<p>x</p>",
					name: "Across chapters",
					priority: 1,
					author_name: "הרב דוגמה",
				},
			]);
			const result = await getArticleSummariesForRanges(crossPerekRanges);
			expect(result).toEqual([
				expect.objectContaining({ id: 7, perekId: 2, name: "Across chapters" }),
			]);
		});

		it("returns empty array on failure", async () => {
			mockQuery.mockRejectedValue(new Error("DB error"));
			const result = await getArticleSummariesForRanges(crossPerekRanges);
			expect(result).toEqual([]);
			mockQuery.mockRejectedValue("raw error");
			expect(await getArticleSummariesForRanges(crossPerekRanges)).toEqual([]);
		});
	});
});
