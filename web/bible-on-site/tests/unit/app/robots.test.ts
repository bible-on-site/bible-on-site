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

	it("publishes AI Content Signals: surfacing uses granted, training withheld", async () => {
		const body = await GET().text();
		const group = body.slice(body.indexOf("User-agent: *"));
		expect(group).toContain(
			"Content-Signal: search=yes, ai-input=yes, ai-train=no",
		);
	});

	it("keeps management/private APIs out while allowing /api/search", async () => {
		const body = await GET().text();
		expect(body).toContain("Disallow: /api/");
		// The narrow exception must come before/around the blanket api rule.
		expect(body).toContain("Allow: /api/search");
	});

	it("withholds the AI-training-only bucket pending the owner's decision", async () => {
		const body = await GET().text();
		const withheld = body.slice(body.indexOf("User-agent: GPTBot"));
		// The withheld group runs to the harvest comment / sitemap tail.
		const group = withheld.slice(0, withheld.indexOf("Sitemap:"));
		for (const ua of [
			"GPTBot",
			"ClaudeBot",
			"CCBot",
			"meta-externalagent",
			"Google-Extended",
			"Applebot-Extended",
			"Diffbot",
			"TikTokSpider",
		]) {
			expect(group).toContain(`User-agent: ${ua}`);
		}
		expect(group).toContain("Disallow: /");
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
		// Applebot itself is graced (Siri/Spotlight answers) — only its
		// training opt-out token is withheld. Match full lines so the
		// Applebot-Extended entry does not count against it.
		expect(body).not.toMatch(/^User-agent: Applebot$/m);
		expect(body).toMatch(/^User-agent: Applebot-Extended$/m);
	});

	it("points crawlers at the canonical sitemap", async () => {
		const body = await GET().text();
		expect(body).toContain("Sitemap: https://canonical.example/sitemap.xml");
	});
});
