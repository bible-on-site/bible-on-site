import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { parashaCanonicalPath } from "../../src/data/parasha/parasha-slugs";
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

	test("API catalog keeps its canonical Link header through the proxy for GET and HEAD", async ({
		request,
	}) => {
		for (const method of ["GET", "HEAD"]) {
			const response = await request.fetch("/.well-known/api-catalog", {
				method,
			});
			expect(response.status()).toBe(200);
			expect(response.headers().link).toBe(
				`<${SITE_ORIGIN}/.well-known/api-catalog>; rel="api-catalog"`,
			);
			expect(response.headers()["content-type"]).toContain(
				"application/linkset+json",
			);
			if (method === "HEAD") expect(await response.body()).toHaveLength(0);
		}
	});

	test("sitemap keeps canonical chapters and Parasha readings without Masora or invented dates", () => {
		const xml = readGeneratedBody("/sitemap.xml").toString("utf8");
		expect(xml).not.toContain("<lastmod>");
		const locations = sitemapLocations();
		expect(locations).toContain(SITE_ORIGIN);
		const configuredOrigin = new URL(SITE_ORIGIN).origin;
		const urls = locations.map((location) => new URL(location));
		expect(
			urls
				.filter(
					(url) =>
						url.origin !== configuredOrigin ||
						url.search !== "" ||
						url.hash !== "",
				)
				.map((url) => url.href),
			"Every sitemap URL must use the configured origin without queries or fragments",
		).toEqual([]);
		const paths = urls.map((url) => decodeURIComponent(url.pathname));
		expect(paths.filter((path) => /^\/929\/\d+$/.test(path)).sort()).toEqual(
			Array.from({ length: 929 }, (_, index) => `/929/${index + 1}`).sort(),
		);
		expect(paths.filter((path) => /^\/פרשה(?:\/|$)/.test(path)).sort()).toEqual(
			[
				"/פרשה",
				...Array.from({ length: 54 }, (_, index) =>
					parashaCanonicalPath(index + 1),
				),
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
			`# תנ"ך על הפרק is a זיכוי הרבים project: the public learning
# corpus is open for search, AI answers, and model training.
# Learning from our content in model weights is welcome in itself.
# Content Signals per contentsignals.org:
#   search   - index the content and show links/snippets in results
#   ai-input - use the content inside AI answers (RAG, grounding)
#   ai-train - use the content to train or fine-tune models
# Search, AI input, training and fine-tuning are all welcome.
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /
Allow: /api/search
Allow: /api/health
Disallow: /api/
Disallow: /dev

# SEO/scraper bucket (MJ12bot, AhrefsBot,
# SemrushBot, DotBot, PetalBot, BLEXBot, MegaIndex, Sogou,
# DataForSeoBot): hard-blocked at the edge/proxy — they ignore robots.

Sitemap: ${SITE_ORIGIN}/sitemap.xml
Agentmap: ${SITE_ORIGIN}/.well-known/ard.json
`,
		);
	});

	// Agent-readiness surfaces (issue #3257): every discovery artifact is
	// prerendered at build time and served identically to any host.
	const AGENT_SURFACES = [
		"/llms.txt",
		"/auth.md",
		"/openapi.json",
		"/.well-known/ai-catalog.json",
		"/.well-known/ard.json",
		"/.well-known/agent-skills/index.json",
		"/.well-known/agent-skills/tanah-corpus-map/SKILL.md",
		"/.well-known/agent-skills/tanah-corpus-search/SKILL.md",
		"/.well-known/agent-skills/tanah-corpus-citation/SKILL.md",
	] as const;

	for (const route of AGENT_SURFACES) {
		test(`${route} serves its prerendered artifact for GET and HEAD`, async ({
			request,
		}) => {
			const manifestPath = resolve(NEXT_BUILD_DIR, "prerender-manifest.json");
			const manifest: PrerenderManifest = JSON.parse(
				readFileSync(manifestPath, "utf8"),
			);
			expect(
				manifest.routes[route],
				`${route} must be prerendered`,
			).toBeDefined();
			expect(manifest.routes[route].initialRevalidateSeconds).toBe(false);

			const response = await request.get(route);
			expect(response.status()).toBe(200);
			const head = await request.head(route);
			expect(head.status()).toBe(200);
			expect(await head.body()).toHaveLength(0);
		});
	}

	test("skills index digests match the exact SKILL.md bytes served", async ({
		request,
	}) => {
		const indexResponse = await request.get(
			"/.well-known/agent-skills/index.json",
		);
		expect(indexResponse.status()).toBe(200);
		const index = await indexResponse.json();
		expect(index.$schema).toBe(
			"https://schemas.agentskills.io/discovery/0.2.0/schema.json",
		);
		for (const skill of index.skills) {
			const artifact = await request.get(new URL(skill.url).pathname);
			expect(artifact.status()).toBe(200);
			const body = await artifact.text();
			expect(
				`sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`,
			).toBe(skill.digest);
		}
	});

	test("the ARD manifest advertises only URLs that really resolve", async ({
		request,
	}) => {
		const manifest = await (await request.get("/.well-known/ard.json")).json();
		for (const entry of manifest.entries) {
			const path = new URL(entry.url).pathname;
			const probe =
				path === "/api/search"
					? `${path}?q=${encodeURIComponent("בראשית")}`
					: path;
			expect(
				(await request.get(probe)).status(),
				`${entry.identifier} -> ${entry.url} must resolve`,
			).toBe(200);
		}
	});

	test("crawler buckets hold on the production server", async ({ request }) => {
		for (const ua of [
			"Googlebot/2.1",
			"GPTBot/1.2",
			"ClaudeBot/1.0",
			"Bytespider",
			"totally-unknown-agent/9.9",
		]) {
			expect(
				(await request.get("/", { headers: { "user-agent": ua } })).status(),
				`${ua} must read the public corpus`,
			).toBe(200);
		}
		for (const ua of ["AhrefsBot/7.0", "MJ12bot/v1.4.8", "SemrushBot/7~bl"]) {
			expect(
				(await request.get("/", { headers: { "user-agent": ua } })).status(),
				`${ua} stays in the blocked bucket`,
			).toBe(403);
		}
	});

	test("HTML responses advertise all four discovery Link relations", async ({
		request,
	}) => {
		for (const method of ["GET", "HEAD"] as const) {
			const link =
				(await request.fetch("/", { method })).headers().link ?? "";
			expect(link).toContain('</llms.txt>; rel="help"');
			expect(link).toContain('rel="api-catalog"');
			expect(link).toContain('rel="ard"');
			expect(link).toContain('rel="sitemap"');
		}
	});
});
