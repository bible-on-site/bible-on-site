import {
	SITEMAP_SECTIONS,
	TOTAL_PERAKIM,
	generateRootEntry,
	generateSectionEntries,
	generate929IndexEntry,
	generatePerekEntries,
	generateSitemapEntries,
	type SitemapConfig,
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

	describe("generateSitemapEntries", () => {
		it("returns all entries combined", () => {
			const result = generateSitemapEntries(mockConfig);

			// 1 root + 6 sections + 1 929 index + 929 perakim = 937
			const expectedLength = 1 + SITEMAP_SECTIONS.length + 1 + TOTAL_PERAKIM;
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

		it("has perek entries at the end", () => {
			const result = generateSitemapEntries(mockConfig);

			const perekStartPosition = 1 + SITEMAP_SECTIONS.length + 1;
			expect(result[perekStartPosition].url).toBe("https://example.com/929/1");
			expect(result[result.length - 1].url).toBe("https://example.com/929/929");
		});
	});
});
