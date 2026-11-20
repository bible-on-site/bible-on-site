import { createHash } from "node:crypto";
import { expect, test } from "../util/playwright/test-fixture";

/**
 * Real-HTTP coverage for the agent-readiness surfaces (issue #3257).
 * These tests exercise the whole request pipeline - proxy, redirects,
 * route handlers - not just handler functions. The same file runs on
 * `next dev` (e2e suite) and the production standalone build (the perf
 * suite re-checks the key assertions in tests/perf/metadata-routes).
 */

const WELCOMED_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131",
	"Googlebot/2.1 (+http://www.google.com/bot.html)",
	"bingbot/2.0",
	"GPTBot/1.2",
	"ClaudeBot/1.0",
	"Claude-User/1.0",
	"OAI-SearchBot/1.0",
	"ChatGPT-User/1.0",
	"PerplexityBot/1.0",
	"CCBot/2.0",
	"meta-externalagent/1.1",
	"Google-Extended",
	"Applebot-Extended",
	"Bytespider",
	"Diffbot/0.1",
	"totally-unknown-agent/9.9",
];

const BLOCKED_SCRAPERS = [
	"MJ12bot/v1.4.8",
	"AhrefsBot/7.0",
	"SemrushBot/7~bl",
	"DotBot/1.2",
	"PetalBot",
	"BLEXBot/1.0",
	"MegaIndex.ru/2.0",
	"Sogou web spider/4.0",
	"DataForSeoBot/1.0",
];

test.describe("discovery documents over real HTTP", () => {
	test("robots.txt serves the open policy, narrow API exceptions and the parked Agentmap hint", async ({
		request,
	}) => {
		const response = await request.get("/robots.txt");
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("text/plain");
		const body = await response.text();
		expect(body).toContain(
			"Content-Signal: search=yes, ai-input=yes, ai-train=yes",
		);
		expect(body).toContain("Allow: /api/search");
		expect(body).toContain("Allow: /api/health");
		expect(body).toContain("Disallow: /api/");
		expect(body).toContain("Disallow: /dev");
		expect(body).toContain("Sitemap: ");
		// Parked in a comment: a live Agentmap directive would trip strict
		// robots.txt validators (Lighthouse robots-txt audit caps SEO < 100%).
		expect(body).toMatch(/^# Agentmap: https?:\/\/.+\/\.well-known\/ard\.json$/m);
		expect(body).not.toMatch(/^Agentmap:/m);
	});

	test("llms.txt serves the agent guide as markdown", async ({ request }) => {
		const response = await request.get("/llms.txt");
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("text/markdown");
		const body = await response.text();
		expect(body).toContain("search=yes, ai-input=yes, ai-train=yes");
		expect(body).toContain("/.well-known/agent-skills/index.json");
		expect(body).toContain("/auth.md");
	});

	test("openapi.json documents the anonymous public surface", async ({
		request,
	}) => {
		const response = await request.get("/openapi.json");
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain(
			"application/vnd.oai.openapi+json",
		);
		const doc = await response.json();
		expect(doc.openapi).toBe("3.1.0");
		expect(Object.keys(doc.paths)).toEqual(
			expect.arrayContaining([
				"/api/search",
				"/.well-known/ard.json",
				"/.well-known/agent-skills/index.json",
				"/auth.md",
			]),
		);
	});

	test("the RFC 9727 API catalog is a linkset pointing at the public search API", async ({
		request,
	}) => {
		const response = await request.get("/.well-known/api-catalog");
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain(
			"application/linkset+json",
		);
		expect(response.headers().link).toContain('rel="api-catalog"');
		const body = await response.json();
		const hrefs = body.linkset.flatMap(
			(context: { item?: { href: string }[] }) =>
				(context.item ?? []).map((item) => item.href),
		);
		expect(hrefs.some((href: string) => href.endsWith("/api/search"))).toBe(
			true,
		);
	});

	test("ARD and ai-catalog manifests agree and every advertised URL resolves", async ({
		request,
	}) => {
		const ard = await request.get("/.well-known/ard.json");
		expect(ard.status()).toBe(200);
		expect(ard.headers()["content-type"]).toContain("application/ard+json");
		const ai = await request.get("/.well-known/ai-catalog.json");
		expect(ai.status()).toBe(200);
		expect(ai.headers()["content-type"]).toContain(
			"application/ai-catalog+json",
		);
		const manifest = await ard.json();
		expect(manifest.specVersion).toBe("1.0");
		expect(await ai.text()).toBe(await ard.text());

		// Every advertised artifact must be a real fetchable URL on this
		// origin - a catalog that lists dead ends is worse than none.
		for (const entry of manifest.entries) {
			const path = new URL(entry.url).pathname;
			// /api/search requires q: the manifest advertises the endpoint,
			// so prove it is really callable rather than 404ing.
			const probe =
				path === "/api/search" ? `${path}?q=${encodeURIComponent("בראשית")}` : path;
			const artifact = await request.get(probe);
			expect(
				artifact.status(),
				`${entry.identifier} -> ${entry.url} must resolve`,
			).toBe(200);
		}
	});

	test("the skills index validates and each digest matches its served SKILL.md", async ({
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
		expect(index.skills.length).toBeGreaterThanOrEqual(3);
		for (const skill of index.skills) {
			expect(skill.type).toBe("skill-md");
			expect(skill.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
			const artifact = await request.get(new URL(skill.url).pathname);
			expect(artifact.status(), `${skill.name} SKILL.md must exist`).toBe(
				200,
			);
			expect(artifact.headers()["content-type"]).toContain("text/markdown");
			const body = await artifact.text();
			expect(body.startsWith("---\n")).toBe(true);
			expect(body).toContain(`name: ${skill.name}`);
			const actual = `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
			expect(actual, `${skill.name} digest must match its bytes`).toBe(
				skill.digest,
			);
		}
	});

	test("auth.md honestly states that no authentication exists", async ({
		request,
	}) => {
		const response = await request.get("/auth.md");
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("text/markdown");
		const body = await response.text();
		expect(body).toContain("No authentication is required");
		expect(body).toContain("/api/search");
	});

	test("unknown skill names 404 instead of fabricating an artifact", async ({
		request,
	}) => {
		const response = await request.get(
			"/.well-known/agent-skills/no-such-skill/SKILL.md",
		);
		expect(response.status()).toBe(404);
		const traversal = await request.get(
			"/.well-known/agent-skills/..%2F..%2Frobots.txt/SKILL.md",
		);
		// Normalization or the allowlist must stop it - never a served file.
		expect(traversal.status()).not.toBe(200);
	});

	test("HEAD answers every discovery surface with the GET headers", async ({
		request,
	}) => {
		for (const path of [
			"/robots.txt",
			"/llms.txt",
			"/openapi.json",
			"/.well-known/api-catalog",
			"/.well-known/ard.json",
			"/.well-known/ai-catalog.json",
			"/.well-known/agent-skills/index.json",
			"/.well-known/agent-skills/tanah-corpus-map/SKILL.md",
			"/auth.md",
		]) {
			const response = await request.head(path);
			expect(response.status(), `HEAD ${path}`).toBe(200);
			expect((await response.body()).length).toBe(0);
		}
	});
});

test.describe("agent access buckets over real HTTP", () => {
	for (const ua of WELCOMED_AGENTS) {
		test(`serves the same public content to ${ua.split("/")[0]}`, async ({
			request,
		}) => {
			const response = await request.get("/", {
				headers: { "user-agent": ua },
			});
			expect(response.status()).toBe(200);
			expect(response.headers()["content-type"]).toContain("text/html");
		});
	}

	for (const ua of BLOCKED_SCRAPERS) {
		test(`keeps the scraper bucket out: ${ua.split("/")[0]} gets 403`, async ({
			request,
		}) => {
			const response = await request.get("/", {
				headers: { "user-agent": ua },
			});
			expect(response.status()).toBe(403);
		});
	}

	test("a blocked scraper is denied on the API too, not just pages", async ({
		request,
	}) => {
		const response = await request.get("/api/search?q=x", {
			headers: { "user-agent": "AhrefsBot/7.0" },
		});
		expect(response.status()).toBe(403);
	});

	test("ordinary HTML still renders after the discovery requests", async ({
		page,
	}) => {
		await page.goto("/929/1");
		await expect(
			page.getByRole("navigation", { name: "ניווט בין פרקים" }),
		).toBeVisible({ timeout: 60_000 });
	});
});

test.describe("discovery hints on real responses", () => {
	test("HTML responses advertise llms.txt, both catalogs and the sitemap via Link headers", async ({
		request,
	}) => {
		for (const method of ["GET", "HEAD"] as const) {
			const response = await request.fetch("/", { method });
			expect(response.status()).toBe(200);
			const link = response.headers().link ?? "";
			expect(link).toContain('</llms.txt>; rel="help"');
			expect(link).toContain('rel="api-catalog"');
			expect(link).toContain('rel="ard"');
			expect(link).toContain('rel="sitemap"');
		}
	});

	test("the page head carries the ard and ai-catalog link elements", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(page.locator('head link[rel="ard"]')).toHaveAttribute(
			"href",
			"/.well-known/ard.json",
		);
		await expect(
			page.locator('head link[rel="ai-catalog"]'),
		).toHaveAttribute("href", "/.well-known/ai-catalog.json");
	});

	test("the public search endpoint answers a crawler with results", async ({
		request,
	}) => {
		const response = await request.get(
			`/api/search?q=${encodeURIComponent("בראשית")}`,
			{ headers: { "user-agent": "GPTBot/1.2" } },
		);
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body).toHaveProperty("results");
		expect(body).toHaveProperty("availability");
	});

	test("legacy aliases still 308 to canonical paths for agents", async ({
		request,
	}) => {
		const response = await request.get("/tanahpedia", {
			maxRedirects: 0,
			headers: { "user-agent": "ClaudeBot/1.0" },
		});
		expect(response.status()).toBe(308);
		expect(response.headers().location).toContain("/pedia");
	});
});
