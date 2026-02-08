import {
	generate929IndexEntry,
	generateArticleEntries,
	generateAuthorEntries,
	generateAuthorsIndexEntry,
	generatePerekEntries,
	generateRootEntry,
	generateSectionEntries,
	generateSitemapEntries,
	SITEMAP_SECTIONS,
	type SitemapConfig,
	TOTAL_PERAKIM,
} from "@/app/sitemap";

describe("sitemap", () => {
	const mockConfig: SitemapConfig = {
		baseUrl: "https://example.com",
		lastModified: new Date("2026-01-01T00:00:00Z"),
	};

	describe("constants", () => {
		it("has correct sections defined", () => {
			expect(SITEMAP_SECTIONS).toEqual([
				"dailyBulletin",
				"whatsappGroup",
				"tos",
				"app",
				"contact",
				"donation",
			]);
		});

		it("has correct total perakim count", () => {
			expect(TOTAL_PERAKIM).toBe(929);
		});
	});

	describe("generateRootEntry", () => {
		it("returns root URL with correct properties", () => {
			const result = generateRootEntry(mockConfig);

			expect(result).toEqual({
				url: "https://example.com",
				lastModified: mockConfig.lastModified,
				changeFrequency: "daily",
				priority: 1,
			});
		});

		it("uses provided baseUrl", () => {
			const customConfig: SitemapConfig = {
				...mockConfig,
				baseUrl: "https://xn--febl3a.co.il",
			};

			const result = generateRootEntry(customConfig);

			expect(result.url).toBe("https://xn--febl3a.co.il");
		});
	});

	describe("generateSectionEntries", () => {
		it("returns entries for all sections", () => {
			const result = generateSectionEntries(mockConfig);

			expect(result).toHaveLength(SITEMAP_SECTIONS.length);
		});

		it("generates correct URLs for each section", () => {
			const result = generateSectionEntries(mockConfig);

			SITEMAP_SECTIONS.forEach((section, index) => {
				expect(result[index].url).toBe(`https://example.com/${section}`);
			});
		});

		it("sets monthly change frequency for sections", () => {
			const result = generateSectionEntries(mockConfig);

			result.forEach((entry) => {
				expect(entry.changeFrequency).toBe("monthly");
			});
		});

		it("sets priority 0.5 for sections", () => {
			const result = generateSectionEntries(mockConfig);

			result.forEach((entry) => {
				expect(entry.priority).toBe(0.5);
			});
		});
	});

	describe("generate929IndexEntry", () => {
		it("returns 929 index page with correct properties", () => {
			const result = generate929IndexEntry(mockConfig);

			expect(result).toEqual({
				url: "https://example.com/929",
				lastModified: mockConfig.lastModified,
				changeFrequency: "daily",
				priority: 0.9,
			});
		});
	});

	describe("generatePerekEntries", () => {
		it("returns 929 perek entries", () => {
			const result = generatePerekEntries(mockConfig);

			expect(result).toHaveLength(929);
		});

		it("generates sequential perek URLs from 1 to 929", () => {
			const result = generatePerekEntries(mockConfig);

			expect(result[0].url).toBe("https://example.com/929/1");
			expect(result[928].url).toBe("https://example.com/929/929");
		});

		it("sets monthly change frequency for perakim", () => {
			const result = generatePerekEntries(mockConfig);

			result.forEach((entry) => {
				expect(entry.changeFrequency).toBe("monthly");
			});
		});

		it("sets priority 0.8 for perakim", () => {
			const result = generatePerekEntries(mockConfig);

			result.forEach((entry) => {
				expect(entry.priority).toBe(0.8);
			});
		});
	});

	describe("generateArticleEntries", () => {
		const mockArticles = [
			{ articleId: 10, perekId: 1 },
			{ articleId: 20, perekId: 1 },
			{ articleId: 30, perekId: 5 },
		];

		it("returns article entries for provided pairs", () => {
			const result = generateArticleEntries(mockConfig, mockArticles);

			expect(result).toHaveLength(3);
			expect(result[0].url).toBe("https://example.com/929/1/10");
			expect(result[1].url).toBe("https://example.com/929/1/20");
			expect(result[2].url).toBe("https://example.com/929/5/30");
		});

		it("returns empty array when no articles provided", () => {
			const result = generateArticleEntries(mockConfig, []);

			expect(result).toHaveLength(0);
		});

		it("sets monthly change frequency for articles", () => {
			const result = generateArticleEntries(mockConfig, mockArticles);

			result.forEach((entry) => {
				expect(entry.changeFrequency).toBe("monthly");
			});
		});

		it("sets priority 0.7 for articles", () => {
			const result = generateArticleEntries(mockConfig, mockArticles);

			result.forEach((entry) => {
				expect(entry.priority).toBe(0.7);
			});
		});
	});

	describe("generateAuthorsIndexEntry", () => {
		it("returns authors index page with correct properties", () => {
			const result = generateAuthorsIndexEntry(mockConfig);

			expect(result).toEqual({
				url: "https://example.com/929/authors",
				lastModified: mockConfig.lastModified,
				changeFrequency: "monthly",
				priority: 0.7,
			});
		});
	});

	describe("generateAuthorEntries", () => {
		it("returns author entries for provided name slugs", () => {
			const slugs = ["הרב לדוגמא שליטא", "הרב לדוגמא זל", "רב אחר"];
			const result = generateAuthorEntries(mockConfig, slugs);

			expect(result).toHaveLength(3);
			expect(result[0].url).toBe(
				`https://example.com/929/authors/${encodeURIComponent("הרב לדוגמא שליטא")}`,
			);
			expect(result[1].url).toBe(
				`https://example.com/929/authors/${encodeURIComponent("הרב לדוגמא זל")}`,
			);
			expect(result[2].url).toBe(
				`https://example.com/929/authors/${encodeURIComponent("רב אחר")}`,
			);
		});

		it("returns empty array when no author slugs provided", () => {
			const result = generateAuthorEntries(mockConfig, []);

			expect(result).toHaveLength(0);
		});

		it("sets monthly change frequency for authors", () => {
			const result = generateAuthorEntries(mockConfig, ["a", "b"]);

			result.forEach((entry) => {
				expect(entry.changeFrequency).toBe("monthly");
			});
		});

		it("sets priority 0.6 for authors", () => {
			const result = generateAuthorEntries(mockConfig, ["a", "b"]);

			result.forEach((entry) => {
				expect(entry.priority).toBe(0.6);
			});
		});
	});

	describe("generateSitemapEntries", () => {
		it("returns all entries combined", () => {
			const result = generateSitemapEntries(mockConfig);

			// 1 root + 6 sections + 1 929 index + 929 perakim + 1 authors index = 938
			const expectedLength =
				1 + SITEMAP_SECTIONS.length + 1 + TOTAL_PERAKIM + 1;
			expect(result).toHaveLength(expectedLength);
		});

		it("has root entry first with highest priority", () => {
			const result = generateSitemapEntries(mockConfig);

			expect(result[0].url).toBe("https://example.com");
			expect(result[0].priority).toBe(1);
		});

		it("has section entries after root", () => {
			const result = generateSitemapEntries(mockConfig);

			SITEMAP_SECTIONS.forEach((section, index) => {
				expect(result[1 + index].url).toBe(`https://example.com/${section}`);
			});
		});

		it("has 929 index after sections", () => {
			const result = generateSitemapEntries(mockConfig);

			const indexPosition = 1 + SITEMAP_SECTIONS.length;
			expect(result[indexPosition].url).toBe("https://example.com/929");
		});

		it("has perek entries after 929 index", () => {
			const result = generateSitemapEntries(mockConfig);

			const perekStartPosition = 1 + SITEMAP_SECTIONS.length + 1;
			expect(result[perekStartPosition].url).toBe("https://example.com/929/1");
			expect(result[perekStartPosition + TOTAL_PERAKIM - 1].url).toBe(
				"https://example.com/929/929",
			);
		});

		it("has authors index after perek entries when no articles", () => {
			const result = generateSitemapEntries(mockConfig);

			const authorsIndexPosition =
				1 + SITEMAP_SECTIONS.length + 1 + TOTAL_PERAKIM;
			expect(result[authorsIndexPosition].url).toBe(
				"https://example.com/929/authors",
			);
		});

		it("includes article entries between perakim and authors index", () => {
			const mockArticles = [
				{ articleId: 10, perekId: 1 },
				{ articleId: 20, perekId: 5 },
			];
			const result = generateSitemapEntries(mockConfig, [], mockArticles);

			const articleStartPosition =
				1 + SITEMAP_SECTIONS.length + 1 + TOTAL_PERAKIM;
			expect(result[articleStartPosition].url).toBe(
				"https://example.com/929/1/10",
			);
			expect(result[articleStartPosition + 1].url).toBe(
				"https://example.com/929/5/20",
			);

			// Authors index follows articles
			expect(result[articleStartPosition + 2].url).toBe(
				"https://example.com/929/authors",
			);
		});

		it("includes author entries when author slugs provided", () => {
			const slugs = ["הרב א", "הרב ב", "הרב ג"];
			const result = generateSitemapEntries(mockConfig, slugs);

			// 1 root + 6 sections + 1 929 index + 929 perakim + 1 authors index + 3 authors = 941
			const expectedLength =
				1 + SITEMAP_SECTIONS.length + 1 + TOTAL_PERAKIM + 1 + 3;
			expect(result).toHaveLength(expectedLength);

			// Check last 3 entries are author pages
			expect(result[result.length - 1].url).toBe(
				`https://example.com/929/authors/${encodeURIComponent("הרב ג")}`,
			);
			expect(result[result.length - 2].url).toBe(
				`https://example.com/929/authors/${encodeURIComponent("הרב ב")}`,
			);
			expect(result[result.length - 3].url).toBe(
				`https://example.com/929/authors/${encodeURIComponent("הרב א")}`,
			);
		});

		it("includes both articles and authors when both provided", () => {
			const mockArticles = [
				{ articleId: 10, perekId: 1 },
				{ articleId: 30, perekId: 5 },
			];
			const slugs = ["הרב א", "הרב ב"];
			const result = generateSitemapEntries(mockConfig, slugs, mockArticles);

			// 1 root + 6 sections + 1 929 index + 929 perakim + 2 articles + 1 authors index + 2 authors = 942
			const expectedLength =
				1 + SITEMAP_SECTIONS.length + 1 + TOTAL_PERAKIM + 2 + 1 + 2;
			expect(result).toHaveLength(expectedLength);

			// Check articles are present
			const urls = result.map((e) => e.url);
			expect(urls).toContain("https://example.com/929/1/10");
			expect(urls).toContain("https://example.com/929/5/30");

			// Check authors are present
			expect(urls).toContain(
				`https://example.com/929/authors/${encodeURIComponent("הרב א")}`,
			);
			expect(urls).toContain(
				`https://example.com/929/authors/${encodeURIComponent("הרב ב")}`,
			);
		});
	});

});
