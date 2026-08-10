import type { Metadata } from "next";
import {
	CATEGORY_SLUGS,
	resolveCategoryRoute,
} from "@/lib/tanahpedia/category-slug";
import { getAllEntryUniqueNames } from "@/lib/tanahpedia/service";
import type { CategoryKey } from "@/lib/tanahpedia/types";
import { CategoryView, categoryMetadata } from "./category-view";
import { EntryView, entryMetadata } from "./entry-view";

export const dynamic = "force-static";

interface PediaRouteProps {
	params: Promise<{ slug: string }>;
}

// this reserverd function is a magic for caching
/* istanbul ignore next: only runs during next build */
export async function generateStaticParams() {
	const categorySlugs = (Object.keys(CATEGORY_SLUGS) as CategoryKey[]).map(
		(key) => ({ slug: CATEGORY_SLUGS[key] }),
	);
	try {
		const uniqueNames = await getAllEntryUniqueNames();
		// Decoded segment values — Next encodes URLs; runtime `params` match this shape.
		return [...categorySlugs, ...uniqueNames.map((slug) => ({ slug }))];
	} catch {
		// If the database is unavailable during build, entries are generated on demand
		return categorySlugs;
	}
}

export async function generateMetadata({
	params,
}: PediaRouteProps): Promise<Metadata> {
	const { slug } = await params;
	const resolved = resolveCategoryRoute(slug);
	return resolved ? categoryMetadata(resolved) : entryMetadata(slug);
}

export default async function PediaSlugPage({
	params,
}: PediaRouteProps) {
	const { slug } = await params;
	const resolved = resolveCategoryRoute(slug);
	// Legacy English slugs are redirected to their Hebrew form by the proxy.
	return resolved ? (
		<CategoryView resolved={resolved} />
	) : (
		<EntryView slug={slug} />
	);
}
