/**
 * @jest-environment node
 *
 * Discovery completeness (#3257): the Markdown surface must cover every
 * canonical public corpus URL — validated against the REAL sitemap
 * generators, not a hand-picked sample.
 */
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
jest.mock("@/lib/moadim", () => ({
	getPublishedMoedSlugs: jest.fn(),
	MOADIM_ROOT: "/מועדים",
	moedHref: (slug: string) => `/מועדים/${slug}`,
}));

import {
	SITEMAP_SECTIONS,
	generateSitemapEntries,
} from "@/app/sitemap";
import {
	MARKDOWN_ROUTE_FAMILIES,
	markdownTargetForPath,
} from "@/lib/markdown/paths";

const BASE = "https://canonical.example";

function sitemapPaths(): string[] {
	return generateSitemapEntries(
		{ baseUrl: BASE },
		["רב-א"],
		[{ perekId: 1, articleId: 42 }],
		[{ perekId: 1, perushName: 'רש"י' }],
		["אברהם"],
		{},
		["פסח"],
	// `new URL` percent-encodes non-ASCII; compare decoded paths.
	).map((entry) => decodeURIComponent(new URL(entry.url).pathname));
}

describe("markdown surface vs canonical sitemap", () => {
	it("resolves a markdown target for every indexable corpus URL", () => {
		const unresolved: string[] = [];
		for (const path of sitemapPaths()) {
			const isSection = SITEMAP_SECTIONS.some(
				(section) => path === `/${section}` || path === `/${section}/`,
			);
			if (isSection) continue;
			if (!markdownTargetForPath(path)) unresolved.push(path);
		}
		expect(unresolved).toEqual([]);
	});

	it("lists all 929 perakim, parashiot, categories and fixture entities", () => {
		const paths = sitemapPaths();
		expect(paths).toContain("/929/1");
		expect(paths).toContain("/929/929");
		expect(paths).toContain("/929/1/42");
		expect(paths).toContain('/929/1/רש"י');
		expect(paths).toContain("/929/authors");
		expect(paths).toContain("/929/authors/רב-א");
		expect(paths).toContain("/pedia");
		expect(paths).toContain("/pedia/אברהם");
		expect(paths).toContain("/פרשה");
		expect(paths).toContain("/מועדים");
		expect(paths).toContain("/מועדים/פסח");
	});

	it("advertises the families documented in MARKDOWN_ROUTE_FAMILIES", () => {
		// The allowlist's shape stays in sync with the route families the
		// site actually serves — a removed family is a deliberate decision,
		// not drift.
		expect(MARKDOWN_ROUTE_FAMILIES).toEqual(
			expect.arrayContaining([
				"/",
				"/929",
				"/929/{perekId}",
				"/929/{perekId}/{articleId}",
				"/929/{perekId}/{perushName}",
				"/929/authors",
				"/929/authors/{slug}",
				"/פרשה",
				"/פרשה/{parasha}",
				"/מסורה",
				"/מסורה/{unitId}",
				"/מועדים",
				"/מועדים/{slug}",
				"/pedia",
				"/pedia/{slug}",
			]),
		);
	});
});
