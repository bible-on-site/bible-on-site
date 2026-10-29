/** Build-time sitemap generation, with all database families controlled. */
jest.mock("next/headers", () => ({
	headers: jest.fn(() => {
		throw new Error("Sitemap generation must not read request headers");
	}),
}));
jest.mock("@/lib/seo/jsonld", () => ({
	SITE_ORIGIN: "https://canonical.example",
}));
jest.mock("@/lib/articles", () => ({
	getAllArticlePerekIdPairs: jest.fn(),
}));
jest.mock("@/lib/authors", () => ({ getAllAuthorSlugs: jest.fn() }));
jest.mock("@/lib/perushim", () => ({
	getAllPerushPerekNamePairs: jest.fn(),
}));
jest.mock("@/lib/tanahpedia/service", () => ({
	getAllEntryUniqueNames: jest.fn(),
}));
jest.mock("@/lib/seo/perek-images-data", () => ({
	getPerekImagesByChapter: jest.fn(),
}));

import { headers } from "next/headers";
import sitemap, { SITEMAP_SECTIONS, TOTAL_PERAKIM } from "@/app/sitemap";
import { getAllArticlePerekIdPairs } from "@/lib/articles";
import { getAllAuthorSlugs } from "@/lib/authors";
import { getAllPerushPerekNamePairs } from "@/lib/perushim";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";
import { getPerekImagesByChapter } from "@/lib/seo/perek-images-data";
import { CATEGORY_SLUGS } from "@/lib/tanahpedia/category-slug";
import { getAllEntryUniqueNames } from "@/lib/tanahpedia/service";

const BUILD_LOADERS = [
	["authors", getAllAuthorSlugs],
	["articles", getAllArticlePerekIdPairs],
	["commentaries", getAllPerushPerekNamePairs],
	["Tanahpedia entries", getAllEntryUniqueNames],
	["chapter images", getPerekImagesByChapter],
] as const;

// Root, sections, 929 index/chapters, author index, pedia index/categories,
// and the Parasha hub with all 54 portions. No Masora URLs.
const STATIC_COUNT =
	1 +
	SITEMAP_SECTIONS.length +
	1 +
	TOTAL_PERAKIM +
	1 +
	1 +
	Object.keys(CATEGORY_SLUGS).length +
	55;

describe("sitemap build-time snapshot", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getAllAuthorSlugs as jest.Mock).mockResolvedValue(["הרב א", "הרב ב"]);
		(getAllArticlePerekIdPairs as jest.Mock).mockResolvedValue([
			{ articleId: 10, perekId: 1 },
		]);
		(getAllPerushPerekNamePairs as jest.Mock).mockResolvedValue([
			{ perekId: 1, perushName: 'רש"י' },
		]);
		(getAllEntryUniqueNames as jest.Mock).mockResolvedValue(["יעקב"]);
		(getPerekImagesByChapter as jest.Mock).mockResolvedValue({});
	});

	it("includes every fixture family using the configured canonical origin", async () => {
		const result = await sitemap();
		const urls = result.map((entry) => entry.url);
		expect(result).toHaveLength(STATIC_COUNT + 5);
		expect(urls).toEqual(
			expect.arrayContaining([
				SITE_ORIGIN,
				`${SITE_ORIGIN}/929/1`,
				`${SITE_ORIGIN}/929/929`,
				`${SITE_ORIGIN}/929/1/10`,
				`${SITE_ORIGIN}/929/1/${encodeURIComponent('רש"י')}`,
				`${SITE_ORIGIN}/929/authors/${encodeURIComponent("הרב א")}`,
				`${SITE_ORIGIN}/929/authors/${encodeURIComponent("הרב ב")}`,
				`${SITE_ORIGIN}/pedia/${encodeURIComponent("יעקב")}`,
				`${SITE_ORIGIN}/פרשה/וזאת-הברכה`,
			]),
		);
		expect(urls.every((url) => new URL(url).origin === SITE_ORIGIN)).toBe(true);
		expect(urls.filter((url) => url.includes("/פרשה"))).toHaveLength(55);
		expect(
			urls.some((url) =>
				/\/(?:מסורה|masora)(?:\/|$)/.test(decodeURIComponent(url)),
			),
		).toBe(false);
		expect(result.every((entry) => entry.lastModified === undefined)).toBe(
			true,
		);
		expect(headers).not.toHaveBeenCalled();
		for (const [, loader] of BUILD_LOADERS)
			expect(loader).toHaveBeenCalledTimes(1);
	});

	it("accepts successfully empty database families", async () => {
		for (const [, loader] of BUILD_LOADERS)
			(loader as jest.Mock).mockResolvedValue([]);
		(getPerekImagesByChapter as jest.Mock).mockResolvedValue({});
		await expect(sitemap()).resolves.toHaveLength(STATIC_COUNT);
	});

	it.each(BUILD_LOADERS)(
		"rejects a failed %s lookup instead of producing partial XML",
		async (_name, loader) => {
			const failure = new Error("Build data unavailable");
			(loader as jest.Mock).mockRejectedValueOnce(failure);
			await expect(sitemap()).rejects.toBe(failure);
		},
	);
});
