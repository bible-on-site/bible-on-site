import type { MetadataRoute } from "next";
import { headers } from "next/headers";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const headersList = await headers();
	const host = headersList.get("host") ?? "xn--febl3a.co.il";
	const baseUrl = `https://${host}`;

	const now = new Date();

	// Root and section pages
	const sections = [
		"dailyBulletin",
		"whatsappGroup",
		"tos",
		"app",
		"contact",
		"donation",
	];

	const sectionUrls: MetadataRoute.Sitemap = [
		{
			url: baseUrl,
			lastModified: now,
			changeFrequency: "daily",
			priority: 1,
		},
		...sections.map((section) => ({
			url: `${baseUrl}/${section}`,
			lastModified: now,
			changeFrequency: "monthly" as const,
			priority: 0.5,
		})),
	];

	// 929 index page
	const page929Index: MetadataRoute.Sitemap = [
		{
			url: `${baseUrl}/929`,
			lastModified: now,
			changeFrequency: "daily",
			priority: 0.9,
		},
	];

	// All 929 perakim (1-929)
	const perekUrls: MetadataRoute.Sitemap = Array.from(
		{ length: 929 },
		(_, i) => ({
			url: `${baseUrl}/929/${i + 1}`,
			lastModified: now,
			changeFrequency: "monthly" as const,
			priority: 0.8,
		}),
	);

	return [...sectionUrls, ...page929Index, ...perekUrls];
}
