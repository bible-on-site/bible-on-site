import { type NextRequest, NextResponse } from "next/server";
import bookPageSlugs from "@/data/book-page-slugs.json";
import { resolveParashaSegment } from "@/data/parasha/parasha-slugs";
import { markdownPreferred } from "@/lib/markdown/accept";
import {
	MARKDOWN_ROUTE_ROOT,
	markdownTargetForPath,
	splitMarkdownSuffix,
} from "@/lib/markdown/paths";
import { indexNowKey } from "@/lib/seo/indexnow";
import {
	pediaPathFromLegacy,
	resolveCategoryRoute,
} from "@/lib/tanahpedia/category-slug";

/**
 * Agent-readiness policy (#3257): the public corpus is deliberately
 * open — crawlers, agents and browsers receive identical content
 * regardless of `User-agent` (זיכוי הרבים, not an ad business). No UA
 * denylist lives here; the affirmative AI-use policy is published
 * through /robots.txt Content-Signal, /llms.txt and the Markdown
 * representation negotiated below.
 */

// Response-only handling preserves the statically rendered base readings.
const PARASHA_VIEW_PARAMS = [
	"perush",
	"article",
	"haftaraPerush",
	"haftaraArticle",
	"book",
	"bookPage",
	"toc",
	"haftara",
	"reading",
	"scheme",
	"variant",
] as const;

/**
 * Canonical Tanahpedia URL for a request, or `null` when it is already canonical.
 * `/tanahpedia/...` is a permanent alias of `/pedia/...`, and English category
 * segments resolve to their Hebrew slug.
 */
export function canonicalPediaTarget(url: URL): string | null {
	const [root, second] = url.pathname.split("/").filter(Boolean);
	if (root !== "tanahpedia" && root !== "pedia") return null;

	const search = url.searchParams;
	const filters = {
		role: search.get("role") ?? undefined,
		kind: search.get("kind") ?? undefined,
		purity: search.get("purity") ?? undefined,
	};

	if (second === "jerusalem") return "/pedia/ירושלים";
	if (root === "tanahpedia")
		return pediaPathFromLegacy(second ?? null, filters);
	if (!second) return null;

	const resolved = resolveCategoryRoute(second, filters);
	if (!resolved) return null;

	const hasFilters =
		Boolean(filters.role) || Boolean(filters.kind) || Boolean(filters.purity);
	return !resolved.isCanonicalSlug || hasFilters
		? resolved.canonicalPath
		: null;
}

/**
 * Canonical `/פרשה` target for a request, or `null` when it is already
 * canonical (or not a parasha route).
 *
 * Public parasha URLs are the canonical Hebrew-name slugs (issue
 * #2738): numeric unit ids, researched aliases (`שלח לך`, `פרשת X`
 * forms, maqaf/niqqud/space variants), and the ASCII `/parasha` route
 * dir all permanent-redirect to `/פרשה/{slug}`. Segments arrive
 * URI-decoded once (the caller decodes the whole pathname in one step,
 * mirroring the noindex check below); the target path keeps decoded
 * Hebrew segments and `new URL` percent-encodes them exactly once.
 * Unresolvable segments under the ASCII root still consolidate to the
 * Hebrew root so the 404 surfaces on the canonical host path, while
 * unknowns already under `/פרשה` fall through to the router's 404 —
 * never a redirect loop. Book-chrome three-segment paths
 * (`/פרשה/{sefer}/{cover-slug}`) are untouched here.
 */
export function canonicalParashaTarget(segments: string[]): string | null {
	const [root, second, ...rest] = segments;
	if (root !== "פרשה" && root !== "parasha") return null;

	if (root === "parasha") {
		// The ASCII route dir is internal: consolidate every depth to the
		// public Hebrew root, canonicalizing a unit segment when it resolves.
		if (segments.length === 1) return "/פרשה";
		const resolved =
			segments.length === 2 ? resolveParashaSegment(second) : null;
		return resolved
			? `/פרשה/${resolved.slug}`
			: `/פרשה/${[second, ...rest].join("/")}`;
	}

	// Hebrew root: only unit paths (exactly two segments) can redirect.
	if (segments.length !== 2) return null;
	const resolved = resolveParashaSegment(second);
	if (!resolved || resolved.kind === "canonical") return null;
	return `/פרשה/${resolved.slug}`;
}

/**
 * The `Link` headers every public page response advertises: the
 * alternate Markdown representation of the same canonical URL and the
 * agent guides/catalog. Appended (never `set`) so per-route Link
 * headers survive intact.
 */
function discoveryLinkHeaders(contentPath: string): string[] {
	const mdPath = `${contentPath === "/" ? "/" : contentPath}.md`;
	return [
		`<${mdPath}>; rel="alternate"; type="text/markdown"`,
		`</llms.txt>; rel="help"; type="text/markdown"`,
		`</.well-known/api-catalog>; rel="api-catalog"`,
	];
}

export async function proxy(
	request: NextRequest,
): Promise<NextResponse | undefined> {
	const { pathname } = request.nextUrl;

	if (
		pathname.startsWith("/api/health") ||
		pathname.startsWith("/_next/") ||
		pathname.startsWith("/favicon") ||
		/\.(css|js|png|jpg|svg|ico|woff2?)$/.test(pathname)
	) {
		return undefined;
	}

	// IndexNow ownership proof: serve `/<INDEXNOW_KEY>.txt` at the site root
	// on whichever host the request arrived on (.co.il and .com alike). The
	// body is the bare key, as the protocol's file verification expects.
	const key = indexNowKey();
	if (key !== null && pathname === `/${key}.txt`) {
		return new NextResponse(key, {
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	}

	// The `.md` suffix selects the same canonical document the Accept
	// negotiation selects — strip it BEFORE canonicalization so an alias
	// redirect (e.g. /tanahpedia/x.md) lands on the canonical .md URL.
	const { contentPath, isMarkdown } = splitMarkdownSuffix(pathname);

	// Canonicalization runs on the bare content path; a redirect carries
	// the .md suffix forward so explicit-URL agents keep their format.
	const canonicalUrl = new URL(request.nextUrl);
	canonicalUrl.pathname = contentPath;
	const canonicalTarget = canonicalPediaTarget(canonicalUrl);
	if (canonicalTarget) {
		// Filter params (role/kind/purity) are consumed into the canonical
		// slug — the redirect drops the query like the legacy handler did.
		return NextResponse.redirect(
			new URL(
				`${canonicalTarget}${isMarkdown ? ".md" : ""}`,
				request.nextUrl,
			),
			308,
		);
	}

	let segments: string[];
	try {
		segments = decodeURIComponent(contentPath).split("/").filter(Boolean);
	} catch {
		return undefined;
	}
	const parashaTarget = canonicalParashaTarget(segments);
	if (parashaTarget) {
		const destination = new URL(
			`${parashaTarget}${isMarkdown ? ".md" : ""}`,
			request.nextUrl,
		);
		// Reader-mode and content-selection params survive the redirect.
		destination.search = request.nextUrl.search;
		return NextResponse.redirect(destination, 308);
	}

	// Markdown: explicit `.md` URLs always negotiate; content-path
	// requests negotiate only when the client prefers text/markdown.
	// GET/HEAD only — writes/POSTs (incl. Server Actions) never take the
	// Markdown path. The route root is internal: /md/* itself must not
	// re-enter (targets only resolve for canonical paths anyway).
	const isReadMethod = request.method === "GET" || request.method === "HEAD";
	const wantsMarkdown =
		isMarkdown ||
		(isReadMethod && markdownPreferred(request.headers.get("accept")));
	const markdownTarget =
		isReadMethod && wantsMarkdown ? markdownTargetForPath(contentPath) : null;
	if (markdownTarget && !contentPath.startsWith(MARKDOWN_ROUTE_ROOT)) {
		const destination = new URL(
			`${MARKDOWN_ROUTE_ROOT}${contentPath}`,
			request.nextUrl,
		);
		destination.search = request.nextUrl.search;
		// The /md handler emits its own Vary/Link headers — the rewrite
		// must not append duplicates.
		return NextResponse.rewrite(destination);
	}

	const isParasha = segments[0] === "פרשה" || segments[0] === "parasha";
	const isBookChrome =
		segments.length === 3 &&
		["בראשית", "שמות", "ויקרא", "במדבר", "דברים"].includes(segments[1]) &&
		Object.values(bookPageSlugs).includes(segments[2]);
	if (
		isParasha &&
		(isBookChrome ||
			PARASHA_VIEW_PARAMS.some((param) =>
				request.nextUrl.searchParams.has(param),
			))
	) {
		const response = NextResponse.next();
		response.headers.set("X-Robots-Tag", "noindex, follow");
		return response;
	}

	// Discovery headers on public read responses: the page stays HTML,
	// but its alternate Markdown URL + the agent guides are declared.
	// `Vary: Accept` rides only where the path actually negotiates, so
	// cache keys fragment on the corpus surface alone.
	if (isReadMethod && markdownTargetForPath(contentPath)) {
		const response = NextResponse.next();
		response.headers.append("Vary", "Accept");
		for (const link of discoveryLinkHeaders(contentPath)) {
			response.headers.append("Link", link);
		}
		return response;
	}

	return undefined;
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
