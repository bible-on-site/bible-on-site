import type { Metadata } from "next";
import { Suspense } from "react";
import { searchSite } from "@/lib/search/service";
import {
	SEARCH_LIMIT_DEFAULT,
	parseSearchTypes,
	type SearchResponse,
} from "@/lib/search/types";
import { SearchExperience } from "./components/SearchExperience";
import styles from "./search.module.css";

export const metadata: Metadata = {
	title: 'חיפוש | תנ"ך על הפרק',
	description: 'חיפוש בפרקים, פסוקים, פירושים, רבנים ומאמרים של תנ"ך על הפרק',
	// Internal search results are an unbounded duplicate space: indexable
	// query URLs would create crawl traps and low-quality landing pages.
	// noindex keeps them out of Search while follow still lets crawlers
	// reach the canonical content pages the results link to.
	// See docs/website/search.md for the full crawl/index policy.
	robots: { index: false, follow: true },
};

// Results depend on live DB content and the query string on every request.
export const dynamic = "force-dynamic";

interface SearchPageProps {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
	const resolved = await searchParams;
	const rawQuery = resolved.q;
	const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim() ?? "";
	const types = parseSearchTypes(resolved.type);
	let response: SearchResponse | null = null;
	let searchFailed = false;
	if (query) {
		try {
			response = await searchSite(query, types, {
				limit: SEARCH_LIMIT_DEFAULT,
			});
		} catch (error) {
			// Render the interactive error state rather than failing the page;
			// the client can still retry the same query through /api/search.
			console.error(
				"[search] SSR search failed:",
				error instanceof Error ? error.message : error,
			);
			searchFailed = true;
		}
	}

	return (
		<main className={styles.searchPage}>
			<h1 className={styles.pageTitle}>חיפוש</h1>
			{/* useSearchParams inside SearchExperience needs a Suspense boundary;
			    the component does not suspend, so SSR still emits full results. */}
			<Suspense>
				<SearchExperience
					initialQuery={query}
					initialTypes={types}
					initialResults={response}
					initialError={searchFailed}
				/>
			</Suspense>
		</main>
	);
}
