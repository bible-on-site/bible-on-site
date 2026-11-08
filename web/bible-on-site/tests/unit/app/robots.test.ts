jest.mock("next/headers", () => ({
	headers: jest.fn(() => {
		throw new Error("Robots generation must not read request headers");
	}),
}));
jest.mock("@/lib/seo/jsonld", () => ({
	SITE_ORIGIN: "https://canonical.example",
}));

import { headers } from "next/headers";
import robots from "@/app/robots";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

describe("robots build-time output", () => {
	it("allows public crawling and disallows API URLs", () => {
		expect(robots().rules).toEqual({
			userAgent: "*",
			allow: "/",
			disallow: ["/api/"],
		});
	});

	it("advertises the configured canonical sitemap without request headers", () => {
		expect(robots().sitemap).toBe(`${SITE_ORIGIN}/sitemap.xml`);
		expect(headers).not.toHaveBeenCalled();
	});
});
