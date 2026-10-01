import robots from "@/app/robots";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

describe("robots", () => {
	it("allows crawling of public pages and disallows the API", () => {
		const result = robots();
		const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
		expect(rules).toContainEqual({
			userAgent: "*",
			allow: "/",
			disallow: ["/api/"],
		});
	});

	it("advertises only the canonical sitemap", () => {
		expect(robots().sitemap).toBe(`${SITE_ORIGIN}/sitemap.xml`);
	});
});
