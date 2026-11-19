/**
 * @jest-environment node
 */
jest.mock("@/lib/seo/jsonld", () => ({
	SITE_ORIGIN: "https://canonical.example",
}));

import { GET } from "@/app/robots.txt/route";

describe("/robots.txt (issue #3257)", () => {
	it("is serialized as plain text with a wildcard agent group", async () => {
		const response = GET();
		expect(response.headers.get("content-type")).toContain("text/plain");
		const body = await response.text();
		expect(body).toContain("User-agent: *");
		expect(body).toContain("Allow: /");
	});

	it("welcomes search, AI answers, and model training", async () => {
		const body = await GET().text();
		const group = body.slice(body.indexOf("User-agent: *"));
		expect(group).toContain(
			"Content-Signal: search=yes, ai-input=yes, ai-train=yes",
		);
	});

	it("keeps management/private APIs out while allowing documented reads", async () => {
		const body = await GET().text();
		expect(body).toContain("Disallow: /api/");
		// Each documented public endpoint under /api/ gets a narrow exception
		// (issue #3257): the search API and the health status the API catalog
		// advertises. No other /api/ path is allowed.
		expect(body).toContain("Allow: /api/search");
		expect(body).toContain("Allow: /api/health");
		expect(body.match(/^Allow: \/api\//gm)).toHaveLength(2);
		expect(body).toContain("Disallow: /dev");
	});

	it("lets training crawlers inherit the wildcard public/private boundaries", async () => {
		const body = await GET().text();
		expect(body.match(/^User-agent: .+$/gm)).toEqual(["User-agent: *"]);
		expect(body).not.toMatch(/^Disallow: \/$/m);
		expect(body).not.toContain("ai-train=no");
		for (const ua of [
			"GPTBot",
			"ClaudeBot",
			"CCBot",
			"meta-externalagent",
			"Google-Extended",
			"Applebot-Extended",
			"Diffbot",
			"TikTokSpider",
			"Bytespider",
		]) {
			expect(body).not.toContain(`User-agent: ${ua}`);
		}
	});

	it("graces the surfacing siblings — they are not in a disallow group", async () => {
		const body = await GET().text();
		for (const ua of [
			"Googlebot",
			"bingbot",
			"OAI-SearchBot",
			"ChatGPT-User",
			"Claude-User",
			"Claude-SearchBot",
			"PerplexityBot",
			"Amazonbot",
			"FacebookBot",
		]) {
			expect(body).not.toContain(`User-agent: ${ua}`);
		}
		expect(body).not.toMatch(/^User-agent: Applebot$/m);
	});

	it("points crawlers at the canonical sitemap and the ARD manifest", async () => {
		const body = await GET().text();
		expect(body).toContain("Sitemap: https://canonical.example/sitemap.xml");
		// The ARD manifest pointer ships as a comment, not a live `Agentmap:`
		// directive: strict validators (Lighthouse's robots-txt audit) reject
		// any directive outside RFC 9309 plus common extensions, which would
		// cap the SEO audit below the required 100%.
		expect(body).toContain(
			"# Agentmap: https://canonical.example/.well-known/ard.json",
		);
		expect(body).not.toMatch(/^Agentmap:/m);
	});
});
