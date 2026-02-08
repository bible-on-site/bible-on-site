/**
 * Tests for the default sitemap() export.
 * Isolated in a separate file because it requires mocking next/headers
 * and service modules — keeping mocks away from the pure-function tests.
 */

// Mock next/headers for the default sitemap() export
jest.mock("next/headers", () => ({
	headers: jest.fn(),
}));

jest.mock("@/lib/articles", () => ({
	getAllArticlePerekIdPairs: jest.fn(),
}));

jest.mock("@/lib/authors", () => ({
	getAllAuthorIds: jest.fn(),
}));

import sitemapFn, { SITEMAP_SECTIONS, TOTAL_PERAKIM } from "@/app/sitemap";
import { getAllArticlePerekIdPairs } from "@/lib/articles";
import { getAllAuthorIds } from "@/lib/authors";
import { headers } from "next/headers";

describe("sitemap default export", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("builds sitemap using host header and fetched dynamic data", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: (name: string) => (name === "host" ? "example.com" : null),
		});
		(getAllAuthorIds as jest.Mock).mockResolvedValue([1, 2]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([
			{ articleId: 10, perekId: 1 },
		]);

		const result = await sitemapFn();

		const urls = result.map((e) => e.url);
		// root + sections + 929 index + 929 perakim + 1 article + authors index + 2 authors
		const expectedLength =
			1 + SITEMAP_SECTIONS.length + 1 + TOTAL_PERAKIM + 1 + 1 + 2;
		expect(result).toHaveLength(expectedLength);

		expect(urls[0]).toBe("https://example.com");
		expect(urls).toContain("https://example.com/929/1/10");
		expect(urls).toContain("https://example.com/authors");
		expect(urls).toContain("https://example.com/authors/1");
		expect(urls).toContain("https://example.com/authors/2");
	});

	it("falls back to xn--febl3a.co.il when host header is absent", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: () => null,
		});
		(getAllAuthorIds as jest.Mock).mockResolvedValue([]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([]);

		const result = await sitemapFn();

		expect(result[0].url).toBe("https://xn--febl3a.co.il");
	});

	it("fetches authors and articles in parallel", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: (name: string) => (name === "host" ? "test.com" : null),
		});
		(getAllAuthorIds as jest.Mock).mockResolvedValue([]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([]);

		await sitemapFn();

		expect(getAllAuthorIds).toHaveBeenCalledTimes(1);
		expect(getAllArticlePerekIdPairs).toHaveBeenCalledTimes(1);
	});
});
