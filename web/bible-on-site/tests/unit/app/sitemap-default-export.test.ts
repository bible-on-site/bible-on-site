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
	getAllAuthorSlugs: jest.fn(),
}));

jest.mock("@/lib/perushim", () => ({
	getPerushimByPerekId: jest.fn(),
}));

import { headers } from "next/headers";
import sitemapFn, { SITEMAP_SECTIONS, TOTAL_PERAKIM } from "@/app/sitemap";
import { getAllArticlePerekIdPairs } from "@/lib/articles";
import { getAllAuthorSlugs } from "@/lib/authors";
import { getPerushimByPerekId } from "@/lib/perushim";

describe("sitemap default export", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("builds sitemap using host header and fetched dynamic data", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: (name: string) => (name === "host" ? "example.com" : null),
		});
		(getAllAuthorSlugs as jest.Mock).mockResolvedValue(["הרב א", "הרב ב"]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([
			{ articleId: 10, perekId: 1 },
		]);
		// Return empty perushim for all 929 perakim
		(getPerushimByPerekId as jest.Mock).mockResolvedValue([]);

		const result = await sitemapFn();

		const urls = result.map((e) => e.url);
		// root + sections + 929 index + 929 perakim + 1 article + 0 perushim + authors index + 2 authors
		const expectedLength =
			1 + SITEMAP_SECTIONS.length + 1 + TOTAL_PERAKIM + 1 + 1 + 2;
		expect(result).toHaveLength(expectedLength);

		expect(urls[0]).toBe("https://example.com");
		expect(urls).toContain("https://example.com/929/1/10");
		expect(urls).toContain("https://example.com/929/authors");
		expect(urls).toContain(
			`https://example.com/929/authors/${encodeURIComponent("הרב א")}`,
		);
		expect(urls).toContain(
			`https://example.com/929/authors/${encodeURIComponent("הרב ב")}`,
		);
	});

	it("falls back to xn--febl3a.co.il when host header is absent", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: () => null,
		});
		(getAllAuthorSlugs as jest.Mock).mockResolvedValue([]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([]);
		(getPerushimByPerekId as jest.Mock).mockResolvedValue([]);

		const result = await sitemapFn();

		expect(result[0].url).toBe("https://xn--febl3a.co.il");
	});

	it("fetches authors and articles in parallel", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: (name: string) => (name === "host" ? "test.com" : null),
		});
		(getAllAuthorSlugs as jest.Mock).mockResolvedValue([]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([]);
		(getPerushimByPerekId as jest.Mock).mockResolvedValue([]);

		await sitemapFn();

		expect(getAllAuthorSlugs).toHaveBeenCalledTimes(1);
		expect(getAllArticlePerekIdPairs).toHaveBeenCalledTimes(1);
	});

	it("includes perushim URLs in sitemap", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: (name: string) => (name === "host" ? "example.com" : null),
		});
		(getAllAuthorSlugs as jest.Mock).mockResolvedValue([]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([]);
		// Return a perush only for perek 1, empty for rest
		(getPerushimByPerekId as jest.Mock).mockImplementation((perekId: number) =>
			perekId === 1
				? Promise.resolve([
						{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 5 },
					])
				: Promise.resolve([]),
		);

		const result = await sitemapFn();

		const urls = result.map((e) => e.url);
		expect(urls).toContain(
			`https://example.com/929/1/${encodeURIComponent("רש״י")}`,
		);
		// root + sections + 929 index + 929 perakim + 0 articles + 1 perush + authors index + 0 authors
		const expectedLength =
			1 + SITEMAP_SECTIONS.length + 1 + TOTAL_PERAKIM + 0 + 1 + 1 + 0;
		expect(result).toHaveLength(expectedLength);
	});
});
