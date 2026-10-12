import { NextResponse } from "next/server";
import { searchSite } from "@/lib/search/service";
import {
	parseSearchTypes,
	SEARCH_LIMIT_MAX,
	SEARCH_QUERY_MAX_CHARS,
} from "@/lib/search/types";

/**
 * GET /api/search?q=<phrase>&type=<csv>&limit=<n>
 *
 * Query and filter state is intentionally carried in plain GET params so a
 * search URL is shareable and the /search page can SSR the same results.
 * Results are `no-store`: queries are user input and must not be cached on
 * shared infrastructure (see docs/website/search.md). Queries are never
 * persisted — the only record is the transient request log.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const raw = url.searchParams.get("q") ?? "";
	const phrase = raw.trim();
	if (phrase.length === 0 || phrase.length > SEARCH_QUERY_MAX_CHARS) {
		return NextResponse.json(
			{ error: "invalid_query" },
			{ status: phrase.length === 0 ? 400 : 414 },
		);
	}
	const limitParam = url.searchParams.get("limit");
	let limit: number | undefined;
	if (limitParam !== null) {
		// Digits only — parseInt/Number would silently accept "5oops",
		// "0x10", or "5.0", and non-numeric values must not fall back to
		// the default as if the param were absent.
		const parsed = /^[0-9]+$/.test(limitParam) ? Number(limitParam) : Number.NaN;
		if (!Number.isInteger(parsed) || parsed < 1 || parsed > SEARCH_LIMIT_MAX) {
			return NextResponse.json({ error: "invalid_limit" }, { status: 400 });
		}
		limit = parsed;
	}
	const types = parseSearchTypes(url.searchParams.get("type"));
	if (url.searchParams.get("type") !== null && types.length === 0) {
		return NextResponse.json({ error: "invalid_type" }, { status: 400 });
	}
	try {
		const response = await searchSite(phrase, types, { limit });
		return NextResponse.json(response, {
			headers: { "Cache-Control": "no-store" },
		});
	} catch (error) {
		console.error(
			"[search] request failed:",
			error instanceof Error ? error.message : error,
		);
		return NextResponse.json({ error: "search_failed" }, { status: 500 });
	}
}
