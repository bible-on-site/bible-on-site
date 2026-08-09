import type { Metadata } from "next";
import {
	CATEGORY_SLUGS,
	type CategorySearchParams,
	resolveCategoryRoute,
} from "@/lib/tanahpedia/category-slug";
import { getAllEntryUniqueNames } from "@/lib/tanahpedia/service";
import type { CategoryKey } from "@/lib/tanahpedia/types";
import { CategoryView, categoryMetadata } from "./category-view";
import { EntryView, entryMetadata } from "./entry-view";

export const dynamic = "force-dynamic";

interface PediaRouteProps {
	params: Promise<{ slug: string }>;
	searchParams: Promise<CategorySearchParams>;
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
	searchParams,
}: PediaRouteProps): Promise<Metadata> {
	const { slug } = await params;
	const resolved = resolveCategoryRoute(slug, await searchParams);
	return resolved ? categoryMetadata(resolved) : entryMetadata(slug);
}

export default async function PediaSlugPage({
	params,
	searchParams,
}: PediaRouteProps) {
	const { slug } = await params;
	const sp = await searchParams;
	const resolved = resolveCategoryRoute(slug, sp);
	// Legacy English slugs are redirected to their Hebrew form by the proxy.
	return resolved ? (
		<CategoryView resolved={resolved} />
	) : (
		<EntryView slug={slug} />
	);
}
