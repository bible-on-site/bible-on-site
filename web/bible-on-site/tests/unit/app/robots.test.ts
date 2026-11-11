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

	it("points crawlers at the canonical sitemap", async () => {
		const body = await GET().text();
		expect(body).toContain("Sitemap: https://canonical.example/sitemap.xml");
	});
});
