/**
 * Unit tests for the authors service
 */

// Mock the api-client module before importing the service
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

jest.mock("node:fs", () => ({
	...jest.requireActual("node:fs"),
	readFileSync: jest.fn(),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "../../../src/lib/api-client";
import {
	getAllAuthorSlugs,
	getArticlesByAuthorId,
	getAuthorByName,
	getAuthorImageUrl,
} from "../../../src/lib/authors/service";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockReadFile = jest.mocked(readFileSync);
const snapshotCacheKey = Symbol.for("bible-on-site.author-portrait-snapshot");

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
		beforeEach(() => {
			mockReadFile.mockReturnValue("{}");
		});

		afterEach(() => {
			Reflect.deleteProperty(globalThis, snapshotCacheKey);
		});

		function setProductionAssets() {
			jest.replaceProperty(process.env, "NODE_ENV", "production");
			delete process.env.S3_ENDPOINT;
			delete process.env.S3_BUCKET;
			delete process.env.ASSETS_BASE_URL;
			delete process.env.S3_REGION;
			delete process.env.AWS_REGION;
		}

		it("reads the selected portrait from the build snapshot once", () => {
			setProductionAssets();
			process.env.ASSETS_BASE_URL = "https://assets.example/";
			mockReadFile.mockReturnValue(
				JSON.stringify({
					81: "authors/caricatures/future-release/high-res/81.png",
				}),
			);

			expect(getAuthorImageUrl(81)).toBe(
				"https://assets.example/authors/caricatures/future-release/high-res/81.png",
			);
			expect(getAuthorImageUrl(32)).toBe(
				"https://assets.example/authors/high-res/32.jpg",
			);
			expect(mockReadFile).toHaveBeenCalledTimes(1);
			expect(mockReadFile).toHaveBeenCalledWith(
				join(process.cwd(), "public", "generated", "author-portraits.json"),
				"utf8",
			);
		});

		it("uses the versioned JPEG selected after an admin upload", () => {
			setProductionAssets();
			const key =
				"authors/high-res/39.jpg?v=0123456789abcdef0123456789abcdef-2";
			mockReadFile.mockReturnValue(JSON.stringify({ 39: key }));

			expect(getAuthorImageUrl(39)).toBe(
				`https://bible-on-site-assets.s3.il-central-1.amazonaws.com/${key}`,
			);
		});

		it("falls back to the JPEG when the snapshot cannot be read", () => {
			setProductionAssets();
			mockReadFile.mockImplementationOnce(() => {
				throw new Error("file not found");
			});

			expect(getAuthorImageUrl(25)).toBe(
				"https://bible-on-site-assets.s3.il-central-1.amazonaws.com/authors/high-res/25.jpg",
			);
		});

		it.each(["invalid JSON", "[]", "null", '"portrait"'])(
			"falls back to the JPEG for an invalid snapshot body %s",
			(body) => {
				setProductionAssets();
				mockReadFile.mockReturnValue(body);

				expect(getAuthorImageUrl(62)).toBe(
					"https://bible-on-site-assets.s3.il-central-1.amazonaws.com/authors/high-res/62.jpg",
				);
			},
		);

		it("skips invalid entries and keeps valid entries in the same snapshot", () => {
			setProductionAssets();
			process.env.ASSETS_BASE_URL = "https://assets.example";
			mockReadFile.mockReturnValue(
				JSON.stringify({
					25: "authors/caricatures/v2/high-res/26.png",
					32: "authors/caricatures/../high-res/32.png",
					62: "https://example.com/authors/caricatures/v2/high-res/62.png",
					79: "authors/high-res/79.jpg?v=invalid",
					80: { key: "authors/caricatures/v2/high-res/80.png" },
					81: "authors/caricatures/v2/high-res/81.png",
				}),
			);

			for (const id of [25, 32, 62, 79, 80]) {
				expect(getAuthorImageUrl(id)).toBe(
					`https://assets.example/authors/high-res/${id}.jpg`,
				);
			}
			expect(getAuthorImageUrl(81)).toBe(
				"https://assets.example/authors/caricatures/v2/high-res/81.png",
			);
		});

		it("retains the legacy JPG for a non-production bucket", () => {
			jest.replaceProperty(process.env, "NODE_ENV", "production");
			delete process.env.S3_ENDPOINT;
			delete process.env.ASSETS_BASE_URL;
			process.env.S3_BUCKET = "bible-on-site-assets-test";
			process.env.S3_REGION = "il-central-1";

			expect(getAuthorImageUrl(81)).toBe(
				"https://bible-on-site-assets-test.s3.il-central-1.amazonaws.com/authors/high-res/81.jpg",
			);
			expect(mockReadFile).not.toHaveBeenCalled();
		});

		it("builds MinIO URL when S3_ENDPOINT is set", () => {
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
				"http://localhost:4566/bible-on-site-assets/authors/high-res/1.jpg",
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

	describe("checkS3Availability (via getAuthorImageUrl)", () => {
		it("skips check in production mode", () => {
			jest.replaceProperty(process.env, "NODE_ENV", "production");
			process.env.S3_ENDPOINT = "http://localhost:4566";
			delete process.env.ASSETS_BASE_URL;
			delete process.env.S3_BUCKET;

			expect(getAuthorImageUrl(1)).toBe(
				"http://localhost:4566/bible-on-site-assets/authors/high-res/1.jpg",
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

		it("attaches stored reading metrics only where a metric row exists (#2607)", async () => {
			mockQuery
				.mockResolvedValueOnce([
					{ id: 1, perek_id: 10, name: "Article 1", abstract: "Abs 1" },
					{ id: 2, perek_id: 20, name: "Article 2", abstract: null },
				])
				// Second query: the stored metric rows (#2607).
				.mockResolvedValueOnce([
					{ article_id: 1, word_count: 300, estimated_seconds: 82 },
				]);

			const result = await getArticlesByAuthorId(5);

			expect(mockQuery).toHaveBeenNthCalledWith(
				2,
				expect.stringContaining("tanah_article_metric"),
				[1, 2],
			);
			expect(result[0].metric).toEqual({
				wordCount: 300,
				estimatedSeconds: 82,
			});
			// Unknown stays absent — not a fabricated null/zero.
			expect(result[1]).not.toHaveProperty("metric");
		});

		it("only surfaces articles in the 929 chapter range", async () => {
			mockQuery.mockResolvedValue([]);

			await getArticlesByAuthorId(5);

			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("perek_id BETWEEN 1 AND 929"),
				[5],
			);
		});

		it("returns empty array and logs warning on error", async () => {
			const consoleWarn = jest
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			mockQuery.mockRejectedValue(new Error("DB error"));

			await expect(getArticlesByAuthorId(5)).rejects.toThrow("DB error");
			expect(consoleWarn).toHaveBeenCalledWith(
				"Failed to fetch articles for author 5:",
				"DB error",
			);
		});

		it("propagates non-Error rejections without caching them", async () => {
			mockQuery.mockRejectedValue("string error");

			await expect(getArticlesByAuthorId(5)).rejects.toBe("string error");
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch articles for author 5:",
				"string error",
			);
		});
	});

	describe("getAuthorByName", () => {
		it("returns a matched author with empty details", async () => {
			mockQuery.mockResolvedValue([{ id: 1, name: "מחבר", details: null }]);
			expect(await getAuthorByName("מחבר")).toEqual(
				expect.objectContaining({ id: 1, details: "" }),
			);
		});
		it("returns author when normalised name matches", async () => {
			const mockRows = [
				{ id: 1, name: 'הרב לדוגמא שליט"א', details: "תיאור" },
				{ id: 2, name: 'הרב לדוגמא ז"ל', details: "תיאור" },
			];
			mockQuery.mockResolvedValue(mockRows);
			process.env.S3_ENDPOINT = "http://localhost:4566";

			// Search with stripped quotes — should match author 1
			const result = await getAuthorByName("הרב לדוגמא שליטא");

			expect(result).toEqual(
				expect.objectContaining({ id: 1, name: 'הרב לדוגמא שליט"א' }),
			);
		});

		it("matches even when input has quotes and DB name has quotes", async () => {
			const mockRows = [{ id: 1, name: 'הרב לדוגמא שליט"א', details: "תיאור" }];
			mockQuery.mockResolvedValue(mockRows);
			process.env.S3_ENDPOINT = "http://localhost:4566";

			const result = await getAuthorByName('הרב לדוגמא שליט"א');

			expect(result).toEqual(expect.objectContaining({ id: 1 }));
		});

		it("only matches authors with valid chapter articles", async () => {
			mockQuery.mockResolvedValue([]);

			await getAuthorByName("מחבר");

			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("art.perek_id BETWEEN 1 AND 929"),
			);
		});

		it("returns null when no name matches", async () => {
			const mockRows = [{ id: 1, name: 'הרב לדוגמא שליט"א', details: "" }];
			mockQuery.mockResolvedValue(mockRows);

			const result = await getAuthorByName("הרב לא קיים");

			expect(result).toBeNull();
		});

		it("rejects database failures without caching a false 404", async () => {
			mockQuery.mockRejectedValue(new Error("DB error"));

			await expect(getAuthorByName("הרב לדוגמא")).rejects.toThrow("DB error");
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to fetch author by name"),
				"DB error",
			);
		});

		it("propagates non-Error rejections without caching them", async () => {
			mockQuery.mockRejectedValue("string error");

			await expect(getAuthorByName("test")).rejects.toBe("string error");
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to fetch author by name"),
				"string error",
			);
		});
	});

	describe("getAllAuthorSlugs", () => {
		it("returns normalised name slugs", async () => {
			const mockRows = [
				{ id: 1, name: 'הרב לדוגמא שליט"א', details: "" },
				{ id: 2, name: 'הרב לדוגמא ז"ל', details: "" },
			];
			mockQuery.mockResolvedValue(mockRows);

			const result = await getAllAuthorSlugs();

			expect(result).toEqual(["הרב לדוגמא שליטא", "הרב לדוגמא זל"]);
		});

		it("only slugs authors with valid chapter articles", async () => {
			mockQuery.mockResolvedValue([]);

			await getAllAuthorSlugs();

			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("art.perek_id BETWEEN 1 AND 929"),
			);
		});

		it("returns empty array when no authors", async () => {
			mockQuery.mockResolvedValue([]);

			const result = await getAllAuthorSlugs();

			expect(result).toEqual([]);
		});

		it("rejects database failures without caching empty content", async () => {
			mockQuery.mockRejectedValue(new Error("DB error"));

			await expect(getAllAuthorSlugs()).rejects.toThrow("DB error");
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch author slugs:",
				"DB error",
			);
		});

		it("propagates non-Error rejections without caching them", async () => {
			mockQuery.mockRejectedValue("string error");

			await expect(getAllAuthorSlugs()).rejects.toBe("string error");
			expect(console.warn).toHaveBeenCalledWith(
				"Failed to fetch author slugs:",
				"string error",
			);
		});
	});
});
