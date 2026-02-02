/**
 * Unit tests for the authors service
 */

// Mock the api-client module before importing the service
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import {
	getAllAuthorIds,
	getArticlesByAuthorId,
	getAuthorById,
	getAuthorImageUrl,
} from "../../../src/lib/authors/service";

const mockQuery = query as jest.MockedFunction<typeof query>;

describe("authors service", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		jest.clearAllMocks();
		// Suppress console.warn during tests
		jest.spyOn(console, "warn").mockImplementation(() => {});
		// Reset environment variables
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		jest.restoreAllMocks();
		process.env = originalEnv;
	});

	describe("getAuthorImageUrl", () => {
		it("builds LocalStack URL when S3_ENDPOINT is set", () => {
			process.env.S3_ENDPOINT = "http://localhost:4566";
			process.env.S3_BUCKET = "my-bucket";

			expect(getAuthorImageUrl(123)).toBe(
				"http://localhost:4566/my-bucket/authors/high-res/123.jpg",
			);
		});

		it("uses default bucket when S3_BUCKET is not set", () => {
			process.env.S3_ENDPOINT = "http://localhost:4566";
			delete process.env.S3_BUCKET;

			expect(getAuthorImageUrl(1)).toBe(
				"http://localhost:4566/bible-on-site-images/authors/high-res/1.jpg",
			);
		});

		it("builds AWS S3 URL when S3_ENDPOINT is not set", () => {
			delete process.env.S3_ENDPOINT;
			process.env.S3_BUCKET = "my-bucket";
			process.env.S3_REGION = "eu-west-1";

			expect(getAuthorImageUrl(42)).toBe(
				"https://my-bucket.s3.eu-west-1.amazonaws.com/authors/high-res/42.jpg",
			);
		});

		it("uses AWS_REGION fallback when S3_REGION is not set", () => {
			delete process.env.S3_ENDPOINT;
			delete process.env.S3_REGION;
			process.env.AWS_REGION = "ap-southeast-1";
			process.env.S3_BUCKET = "my-bucket";

			expect(getAuthorImageUrl(5)).toBe(
				"https://my-bucket.s3.ap-southeast-1.amazonaws.com/authors/high-res/5.jpg",
			);
		});

		it("uses default region when neither S3_REGION nor AWS_REGION is set", () => {
			delete process.env.S3_ENDPOINT;
			delete process.env.S3_REGION;
			delete process.env.AWS_REGION;
			process.env.S3_BUCKET = "my-bucket";

			expect(getAuthorImageUrl(99)).toBe(
				"https://my-bucket.s3.il-central-1.amazonaws.com/authors/high-res/99.jpg",
			);
		});
	});

	describe("getAuthorById", () => {
		it("returns mapped author when found", async () => {
			const mockRow = {
				id: 1,
				name: "Test Author",
				details: "Some details",
			};

			mockQuery.mockResolvedValue([mockRow]);
			process.env.S3_ENDPOINT = "http://localhost:4566";

			const result = await getAuthorById(1);

			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("SELECT id, name, details"),
				[1],
			);

			expect(result).toEqual({
				id: 1,
				name: "Test Author",
				details: "Some details",
				imageUrl: "http://localhost:4566/bible-on-site-images/authors/high-res/1.jpg",
			});
		});

		it("returns null when author not found", async () => {
			mockQuery.mockResolvedValue([]);

			const result = await getAuthorById(999);

			expect(result).toBeNull();
		});

		it("returns null and logs warning on error", async () => {
			const consoleWarn = jest
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			mockQuery.mockRejectedValue(new Error("DB error"));

			const result = await getAuthorById(1);

			expect(result).toBeNull();
			expect(consoleWarn).toHaveBeenCalledWith(
				"Failed to fetch author 1:",
				"DB error",
			);
		});

		it("handles empty details as empty string", async () => {
			const mockRow = {
				id: 1,
				name: "Test Author",
				details: "",
			};

			mockQuery.mockResolvedValue([mockRow]);
			process.env.S3_ENDPOINT = "http://localhost:4566";

			const result = await getAuthorById(1);

			expect(result?.details).toBe("");
			expect(result?.imageUrl).toBe(
				"http://localhost:4566/bible-on-site-images/authors/high-res/1.jpg",
			);
		});
	});

	describe("getArticlesByAuthorId", () => {
		it("returns mapped articles when found", async () => {
			const mockRows = [
				{ id: 1, perek_id: 10, name: "Article 1", abstract: "Abstract 1" },
				{ id: 2, perek_id: 20, name: "Article 2", abstract: null },
			];

			mockQuery.mockResolvedValue(mockRows);

			const result = await getArticlesByAuthorId(5);

			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("SELECT id, perek_id, name, abstract"),
				[5],
			);

			expect(result).toEqual([
				{ id: 1, perekId: 10, name: "Article 1", abstract: "Abstract 1" },
				{ id: 2, perekId: 20, name: "Article 2", abstract: null },
			]);
		});

		it("returns empty array when no articles found", async () => {
			mockQuery.mockResolvedValue([]);

			const result = await getArticlesByAuthorId(999);

			expect(result).toEqual([]);
		});

		it("returns empty array and logs warning on error", async () => {
			const consoleWarn = jest
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			mockQuery.mockRejectedValue(new Error("DB error"));

			const result = await getArticlesByAuthorId(5);

			expect(result).toEqual([]);
			expect(consoleWarn).toHaveBeenCalledWith(
				"Failed to fetch articles for author 5:",
				"DB error",
			);
		});
	});

	describe("getAllAuthorIds", () => {
		it("returns array of author IDs", async () => {
			mockQuery.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);

			const result = await getAllAuthorIds();

			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("SELECT id FROM tanah_author"),
			);

			expect(result).toEqual([1, 2, 3]);
		});

		it("returns empty array when no authors", async () => {
			mockQuery.mockResolvedValue([]);

			const result = await getAllAuthorIds();

			expect(result).toEqual([]);
		});

		it("returns empty array and logs warning on error", async () => {
			const consoleWarn = jest
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			mockQuery.mockRejectedValue(new Error("DB error"));

			const result = await getAllAuthorIds();

			expect(result).toEqual([]);
			expect(consoleWarn).toHaveBeenCalledWith(
				"Failed to fetch author IDs:",
				"DB error",
			);
		});
	});
});
