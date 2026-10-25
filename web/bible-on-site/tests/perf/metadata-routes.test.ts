import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { SITE_ORIGIN } from "../../src/lib/seo/jsonld";

const NEXT_BUILD_DIR = resolve(__dirname, "../../.next");
const METADATA_ROUTES = ["/sitemap.xml", "/robots.txt"] as const;

interface PrerenderManifest {
	routes: Record<string, { initialRevalidateSeconds: number | false }>;
}

function readGeneratedBody(route: (typeof METADATA_ROUTES)[number]): Buffer {
	const bodyPath = resolve(
		NEXT_BUILD_DIR,
		"server/app",
		`${route.slice(1)}.body`,
	);
	expect(
		existsSync(bodyPath),
		`${route} needs a build-time body artifact`,
	).toBe(true);
	return readFileSync(bodyPath);
}

function sitemapLocations(): string[] {
	const xml = readGeneratedBody("/sitemap.xml").toString("utf8");
	return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
}

test.describe("Production metadata snapshots", () => {
	// biome-ignore lint/correctness/noEmptyPattern: Playwright requires fixture destructuring
	test.beforeEach(({}, testInfo) => {
		testInfo.skip(
			testInfo.project.name !== "Desktop",
			"Metadata build artifacts only need checking once",
		);
	});

	for (const route of METADATA_ROUTES) {
		test(`${route} serves its permanent build artifact regardless of request host`, async ({
			request,
		}) => {
			const manifestPath = resolve(NEXT_BUILD_DIR, "prerender-manifest.json");
			expect(existsSync(manifestPath), "Run a production build first").toBe(
				true,
			);
			const manifest: PrerenderManifest = JSON.parse(
				readFileSync(manifestPath, "utf8"),
			);
			expect(
				manifest.routes[route],
				`${route} must be prerendered`,
			).toBeDefined();
			expect(manifest.routes[route].initialRevalidateSeconds).toBe(false);
			const generatedBody = readGeneratedBody(route);

			const requestHeaders: Record<string, string>[] = [
				{},
				{ host: "untrusted-host.example" },
				{ "x-forwarded-host": "untrusted-forwarded.example" },
				{
					host: "untrusted-host.example",
					"x-forwarded-host": "untrusted-forwarded.example",
				},
				{},
			];
			for (const headers of requestHeaders) {
				const response = await request.get(route, { headers });
				expect(response.status()).toBe(200);
				expect(response.headers()["content-type"]).toContain(
					route === "/sitemap.xml" ? "application/xml" : "text/plain",
				);
				expect(await response.body()).toEqual(generatedBody);
			}
		});
	}

	test("sitemap keeps canonical chapters and Parasha readings without Masora or invented dates", () => {
		const xml = readGeneratedBody("/sitemap.xml").toString("utf8");
		expect(xml).not.toContain("<lastmod>");
		const locations = sitemapLocations();
		expect(locations).toContain(SITE_ORIGIN);
		const paths = locations.map((location) => {
			const url = new URL(location);
			expect(url.origin).toBe(new URL(SITE_ORIGIN).origin);
			expect(url.search).toBe("");
			expect(url.hash).toBe("");
			return decodeURIComponent(url.pathname);
		});
		expect(paths.filter((path) => /^\/929\/\d+$/.test(path)).sort()).toEqual(
			Array.from({ length: 929 }, (_, index) => `/929/${index + 1}`).sort(),
		);
		expect(paths.filter((path) => /^\/פרשה(?:\/|$)/.test(path)).sort()).toEqual(
			[
				"/פרשה",
				...Array.from({ length: 54 }, (_, index) => `/פרשה/${index + 1}`),
			].sort(),
		);
		expect(
			paths.filter((path) => /^\/(?:מסורה|masora)(?:\/|$)/.test(path)),
		).toEqual([]);
	});

	test("sitemap includes the seeded article, author, commentary and Tanahpedia entry", () => {
		// CI's mysql-populate loads tanah_test_data.sql and the Jacob family SQL.
		// The full perushim artifact also includes Rashi on the first chapter.
		const fixturePaths = [
			"/929/1/1",
			`/929/authors/${encodeURIComponent("הרב לדוגמא שליטא")}`,
			`/929/1/${encodeURIComponent('רש"י')}`,
			`/pedia/${encodeURIComponent("יעקב")}`,
		];
		const locations = sitemapLocations();
		for (const path of fixturePaths) {
			expect(
				locations,
				`Build-time database entry ${path} must be published`,
			).toContain(`${SITE_ORIGIN}${path}`);
		}
	});

	test("robots publishes the configured sitemap while keeping noindex pages crawlable", () => {
		const robots = readGeneratedBody("/robots.txt").toString("utf8");
		expect(robots).toBe(
			`User-Agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
		);
	});
});
