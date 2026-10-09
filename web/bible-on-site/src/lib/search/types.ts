/**
 * Website internal-search result contract.
 *
 * Mirrors the native app's `SearchFilter` result types (perakim, pesukim,
 * perushim, authors) and adds articles. The `/api/search` route and the
 * `/search` page both speak this contract; the article-content provider seam
 * (`searchArticles`) is where the Rust semantic-search API from the #2039
 * follow-up plugs in once it is available.
 */

export const SEARCH_RESULT_TYPES = [
	"perek",
	"pasuk",
	"perush",
	"author",
	"article",
] as const;

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

/** Hebrew display name for each result type (matches the app's labels). */
export const SEARCH_TYPE_LABELS: Record<SearchResultType, string> = {
	perek: "פרקים",
	pasuk: "פסוקים",
	perush: "פירושים",
	author: "רבנים",
	article: "מאמרים",
};

/** Fixed, predictable section order for grouped results. */
export const SEARCH_TYPE_ORDER: readonly SearchResultType[] =
	SEARCH_RESULT_TYPES;

/** Per-type result cap bounds; `limit` in the API contract is per type. */
export const SEARCH_LIMIT_DEFAULT = 10;
export const SEARCH_LIMIT_MAX = 50;

/** Query sanity bounds — mirrors the native app's guards. */
export const SEARCH_QUERY_MAX_CHARS = 256;
export const SEARCH_QUERY_MAX_TERMS = 16;

/**
 * Whitelist-parse the `type` filter param. Accepts a comma-separated
 * string or repeated params; a missing/empty param means "all types"
 * (so the canonical URL can omit it), while a present-but-unknown
 * value simply drops out of the result set.
 */
export function parseSearchTypes(
	raw: string | string[] | undefined | null,
): SearchResultType[] {
	if (!raw) return [...SEARCH_RESULT_TYPES];
	const values = (Array.isArray(raw) ? raw : raw.split(","))
		.flatMap((value) => value.split(","))
		.map((value) => value.trim());
	const types = values.filter((value): value is SearchResultType =>
		(SEARCH_RESULT_TYPES as readonly string[]).includes(value),
	);
	return [...new Set(types)];
}

export interface SearchResultItem {
	type: SearchResultType;
	/**
	 * Result title, e.g. "בראשית לב כג", "רש"י בראשית א א" or an author name.
	 * Plain text — render escaped.
	 */
	title: string;
	/**
	 * HTML-safe excerpt. Everything except the <mark> highlight tags is
	 * HTML-escaped server-side, so it can be rendered via
	 * dangerouslySetInnerHTML without an XSS surface.
	 */
	snippetHtml: string | null;
	/** Canonical site-relative link target for the result. */
	href: string;
	/** Relevance score; higher is better. See score.ts. */
	score: number;
}

export interface SearchResponse {
	/** The normalized query that was actually searched. */
	query: string;
	/** Result types that were searched (after whitelist filtering). */
	types: SearchResultType[];
	/** Results grouped implicitly by `type`, ordered by score within a type. */
	results: SearchResultItem[];
	/** Number of results returned per type. */
	counts: Partial<Record<SearchResultType, number>>;
	/**
	 * Non-fatal availability notices, e.g. when a backend is unreachable the
	 * user still gets the other result types plus a notice here.
	 */
	availability: string[];
}
