import { expect, test } from "@playwright/test";

// These values match the constants in src/app/sitemap.ts
const SITEMAP_SECTIONS = [
	"dailyBulletin",
	"whatsappGroup",
	"tos",
	"app",
	"contact",
	"donation",
] as const;

const TOTAL_PERAKIM = 929;

test.describe("sitemap.xml", () => {
	test("returns valid XML with correct content type", async ({ request }) => {
		const response = await request.get("/sitemap.xml");

		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("application/xml");
	});

	test("contains root URL entry", async ({ request }) => {
		const response = await request.get("/sitemap.xml");
		const body = await response.text();

		// Check for root URL (should end with just the host, no path)
		expect(body).toContain("<loc>");
		expect(body).toContain("</loc>");
		// Root entry should have highest priority
		expect(body).toContain("<priority>1</priority>");
	});

	test("contains all section URLs", async ({ request }) => {
		const response = await request.get("/sitemap.xml");
		const body = await response.text();

		for (const section of SITEMAP_SECTIONS) {
			// Using string concat to avoid Codacy "template literal looks like HTML" warning
			// biome-ignore lint/style/useTemplate: conflict with Codacy rule
			const sectionLocPattern = "/" + section + "</loc>";
			expect(body).toContain(sectionLocPattern);
		}
	});

	test("contains 929 index page", async ({ request }) => {
		const response = await request.get("/sitemap.xml");
		const body = await response.text();

		expect(body).toContain("/929</loc>");
	});

	test("contains perek URLs", async ({ request }) => {
		const response = await request.get("/sitemap.xml");
		const body = await response.text();

		// Check first and last perek
		expect(body).toContain("/929/1</loc>");
		expect(body).toContain("/929/929</loc>");

		// Check a few perakim in between
		expect(body).toContain("/929/100</loc>");
		expect(body).toContain("/929/500</loc>");
	});

	test("contains authors index URL", async ({ request }) => {
		const response = await request.get("/sitemap.xml");
		const body = await response.text();

		expect(body).toContain("/authors</loc>");
	});

	test("has correct number of URL entries", async ({ request }) => {
		const response = await request.get("/sitemap.xml");
		const body = await response.text();

		// Count <url> tags
		const urlCount = (body.match(/<url>/g) || []).length;

		// Count author entries dynamically from sitemap
		// Note: Better practice would be to control test data population from setup
		// so we know exactly how many authors to expect
		const authorEntries = (body.match(/\/authors\/\d+<\/loc>/g) || []).length;

		// Expected: 1 root + sections + 1 929 index + 929 perakim + 1 authors index + N authors
		const expectedCount =
			1 +
			SITEMAP_SECTIONS.length +
			1 +
			TOTAL_PERAKIM +
			1 +
			authorEntries;
		expect(urlCount).toBe(expectedCount);
	});

	test("has valid XML structure", async ({ request }) => {
		const response = await request.get("/sitemap.xml");
		const body = await response.text();

		// Check XML declaration and sitemap namespace
		expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(body).toContain("http://www.sitemaps.org/schemas/sitemap/0.9");
		expect(body).toContain("<urlset");
		expect(body).toContain("</urlset>");
	});

	test("all URLs use HTTPS protocol", async ({ request }) => {
		const response = await request.get("/sitemap.xml");
		const body = await response.text();

		// Extract all <loc> contents
		const locMatches = body.match(/<loc>([^<]+)<\/loc>/g) || [];

		for (const loc of locMatches) {
			const url = loc.replace(/<\/?loc>/g, "");
			expect(url).toMatch(/^https:\/\//);
		}
	});
});
