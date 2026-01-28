import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getAllAuthorIds } from "../lib/authors";

/**
 * Static section paths for the sitemap
 */
export const SITEMAP_SECTIONS = [
	"dailyBulletin",
	"whatsappGroup",
	"tos",
	"app",
	"contact",
	"donation",
] as const;

/**
 * Total number of perakim in the 929 cycle
 */
export const TOTAL_PERAKIM = 929;

export interface SitemapConfig {
	baseUrl: string;
	lastModified: Date;
}

/**
 * Generates the root URL entry for the sitemap
 */
export function generateRootEntry(
	config: SitemapConfig,
): MetadataRoute.Sitemap[0] {
	return {
		url: config.baseUrl,
		lastModified: config.lastModified,
		changeFrequency: "daily",
		priority: 1,
	};
}

/**
 * Generates section URL entries for the sitemap
 */
export function generateSectionEntries(
	config: SitemapConfig,
): MetadataRoute.Sitemap {
	return SITEMAP_SECTIONS.map((section) => ({
		url: `${config.baseUrl}/${section}`,
		lastModified: config.lastModified,
		changeFrequency: "monthly" as const,
		priority: 0.5,
	}));
}

/**
 * Generates the 929 index page entry
 */
export function generate929IndexEntry(
	config: SitemapConfig,
): MetadataRoute.Sitemap[0] {
	return {
		url: `${config.baseUrl}/929`,
		lastModified: config.lastModified,
		changeFrequency: "daily",
		priority: 0.9,
	};
}

/**
 * Generates all 929 perek URL entries
 */
export function generatePerekEntries(
	config: SitemapConfig,
): MetadataRoute.Sitemap {
	return Array.from({ length: TOTAL_PERAKIM }, (_, i) => ({
		url: `${config.baseUrl}/929/${i + 1}`,
		lastModified: config.lastModified,
		changeFrequency: "monthly" as const,
		priority: 0.8,
	}));
}

/**
 * Generates the authors index page entry
 */
export function generateAuthorsIndexEntry(
	config: SitemapConfig,
): MetadataRoute.Sitemap[0] {
	return {
		url: `${config.baseUrl}/authors`,
		lastModified: config.lastModified,
		changeFrequency: "monthly",
		priority: 0.7,
	};
}

/**
 * Generates author page URL entries
 */
export function generateAuthorEntries(
	config: SitemapConfig,
	authorIds: number[],
): MetadataRoute.Sitemap {
	return authorIds.map((id) => ({
		url: `${config.baseUrl}/authors/${id}`,
		lastModified: config.lastModified,
		changeFrequency: "monthly" as const,
		priority: 0.6,
	}));
}

/**
 * Generates the complete sitemap entries (pure function for testing)
 */
export function generateSitemapEntries(
	config: SitemapConfig,
	authorIds: number[] = [],
): MetadataRoute.Sitemap {
	return [
		generateRootEntry(config),
		...generateSectionEntries(config),
		generate929IndexEntry(config),
		...generatePerekEntries(config),
		generateAuthorsIndexEntry(config),
		...generateAuthorEntries(config, authorIds),
	];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const headersList = await headers();
	/* istanbul ignore next: fallback for malformed requests without Host header */
	const host = headersList.get("host") ?? "xn--febl3a.co.il";
	const baseUrl = `https://${host}`;

	// Fetch author IDs for dynamic sitemap entries
	const authorIds = await getAllAuthorIds();

	return generateSitemapEntries(
		{
			baseUrl,
			lastModified: new Date(),
		},
		authorIds,
	);
}
