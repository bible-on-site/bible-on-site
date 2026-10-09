import type { MetadataRoute } from "next";
import { headers } from "next/headers";

const FALLBACK_HOST = "xn--febl3a.co.il";

export default async function robots(): Promise<MetadataRoute.Robots> {
	const headersList = await headers();
	/* istanbul ignore next: fallback for malformed requests without Host header */
	const host = headersList.get("host") ?? FALLBACK_HOST;
	const baseUrl = `https://${host}`;

	return {
		rules: {
			userAgent: "*",
			allow: "/",
			disallow: ["/api/"],
		},
		sitemap: `${baseUrl}/sitemap.xml`,
	};
}
