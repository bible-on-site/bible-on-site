/**
 * Tests for the default sitemap() export.
 * Isolated in a separate file because it mocks service modules, keeping
 * those mocks away from the pure-function tests.
 */

jest.mock("@/lib/articles", () => ({
	getAllArticlePerekIdPairs: jest.fn(),
}));

jest.mock("@/lib/authors", () => ({
	getAllAuthorSlugs: jest.fn(),
}));

jest.mock("@/lib/perushim", () => ({
	getPerushimByPerekId: jest.fn(),
}));

jest.mock("@/lib/tanahpedia/service", () => ({
	getAllEntryUniqueNames: jest.fn(),
}));

import sitemapFn, { SITEMAP_SECTIONS, TOTAL_PERAKIM } from "@/app/sitemap";
import { getAllArticlePerekIdPairs } from "@/lib/articles";
import { getAllAuthorSlugs } from "@/lib/authors";
import { getPerushimByPerekId } from "@/lib/perushim";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";
import { CATEGORY_SLUGS } from "@/lib/tanahpedia/category-slug";
import { getAllEntryUniqueNames } from "@/lib/tanahpedia/service";

/** `/pedia` landing entry plus one entry per Hebrew category slug. */
const PEDIA_STATIC_COUNT = 1 + Object.keys(CATEGORY_SLUGS).length;

describe("sitemap default export", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("builds canonical sitemap using fetched dynamic data", async () => {
		(getAllAuthorSlugs as jest.Mock).mockResolvedValue(["הרב א", "הרב ב"]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([
			{ articleId: 10, perekId: 1 },
		]);
		// Return empty perushim for all 929 perakim
		(getPerushimByPerekId as jest.Mock).mockResolvedValue([]);
		(getAllEntryUniqueNames as jest.Mock).mockResolvedValue(["יעקב"]);

		const result = await sitemapFn();

		const urls = result.map((e) => e.url);
		// root + sections + 929 index + 929 perakim + 1 article + 0 perushim + authors index + 2 authors + 1 pedia
		const expectedLength =
			1 +
			SITEMAP_SECTIONS.length +
			1 +
			TOTAL_PERAKIM +
			1 +
			1 +
			2 +
			PEDIA_STATIC_COUNT +
			1;
		expect(result).toHaveLength(expectedLength);

		expect(urls[0]).toBe(SITE_ORIGIN);
		expect(urls).toContain(`${SITE_ORIGIN}/929/1/10`);
		expect(urls).toContain(`${SITE_ORIGIN}/929/authors`);
		expect(urls).toContain(
			`${SITE_ORIGIN}/929/authors/${encodeURIComponent("הרב א")}`,
		);
		expect(urls).toContain(
			`${SITE_ORIGIN}/929/authors/${encodeURIComponent("הרב ב")}`,
		);
		expect(urls).toContain(
			`${SITE_ORIGIN}/pedia/${encodeURIComponent("יעקב")}`,
		);
	});

	it("uses the same origin without a request host", async () => {
		(getAllAuthorSlugs as jest.Mock).mockResolvedValue([]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([]);
		(getPerushimByPerekId as jest.Mock).mockResolvedValue([]);
		(getAllEntryUniqueNames as jest.Mock).mockResolvedValue([]);

		const result = await sitemapFn();

		expect(result[0].url).toBe(SITE_ORIGIN);
	});

	it("fetches authors and articles in parallel", async () => {
		(getAllAuthorSlugs as jest.Mock).mockResolvedValue([]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([]);
		(getPerushimByPerekId as jest.Mock).mockResolvedValue([]);
		(getAllEntryUniqueNames as jest.Mock).mockResolvedValue([]);

		await sitemapFn();

		expect(getAllAuthorSlugs).toHaveBeenCalledTimes(1);
		expect(getAllArticlePerekIdPairs).toHaveBeenCalledTimes(1);
		expect(getAllEntryUniqueNames).toHaveBeenCalledTimes(1);
	});

	it("includes perushim URLs in sitemap", async () => {
		(getAllAuthorSlugs as jest.Mock).mockResolvedValue([]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([]);
		(getAllEntryUniqueNames as jest.Mock).mockResolvedValue([]);
		// Return a perush only for perek 1, empty for rest
		(getPerushimByPerekId as jest.Mock).mockImplementation((perekId: number) =>
			perekId === 1
				? Promise.resolve([
						{ id: 1, name: 'רש"י', parshanName: 'רש"י', noteCount: 5 },
					])
				: Promise.resolve([]),
		);

		const result = await sitemapFn();

		const urls = result.map((e) => e.url);
		expect(urls).toContain(
			`${SITE_ORIGIN}/929/1/${encodeURIComponent('רש"י')}`,
		);
		// root + sections + 929 index + 929 perakim + 0 articles + 1 perush + authors index + 0 authors
		const expectedLength =
			1 +
			SITEMAP_SECTIONS.length +
			1 +
			TOTAL_PERAKIM +
			0 +
			1 +
			1 +
			PEDIA_STATIC_COUNT +
			0;
		expect(result).toHaveLength(expectedLength);
	});

	it("includes pedia entry URLs in sitemap", async () => {
		(getAllAuthorSlugs as jest.Mock).mockResolvedValue([]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([]);
		(getPerushimByPerekId as jest.Mock).mockResolvedValue([]);
		(getAllEntryUniqueNames as jest.Mock).mockResolvedValue(["יעקב", "שמשון"]);

		const result = await sitemapFn();

		const urls = result.map((e) => e.url);
		expect(urls).toContain(
			`${SITE_ORIGIN}/pedia/${encodeURIComponent("יעקב")}`,
		);
		expect(urls).toContain(
			`${SITE_ORIGIN}/pedia/${encodeURIComponent("שמשון")}`,
		);
		// root + sections + 929 index + 929 perakim + 0 articles + 0 perushim + authors index + 0 authors + 2 pedias
		const expectedLength =
			1 +
			SITEMAP_SECTIONS.length +
			1 +
			TOTAL_PERAKIM +
			0 +
			0 +
			1 +
			PEDIA_STATIC_COUNT +
			0 +
			2;
		expect(result).toHaveLength(expectedLength);
	});
});
