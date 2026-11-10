import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

export const dynamic = "error";
export const revalidate = false;

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
