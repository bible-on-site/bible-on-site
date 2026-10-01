import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: "*",
			allow: "/",
			disallow: ["/api/"],
		},
		sitemap: `${SITE_ORIGIN}/sitemap.xml`,
	};
}
