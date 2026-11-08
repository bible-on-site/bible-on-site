import { type NextRequest, NextResponse } from "next/server";
import bookPageSlugs from "@/data/book-page-slugs.json";
import { resolveParashaSegment } from "@/data/parasha/parasha-slugs";
import { indexNowKey } from "@/lib/seo/indexnow";
import {
	pediaPathFromLegacy,
	resolveCategoryRoute,
} from "@/lib/tanahpedia/category-slug";

const BLOCKED_BOTS =
	/Bytespider|MJ12bot|AhrefsBot|SemrushBot|DotBot|PetalBot|BLEXBot|MegaIndex|Sogou|DataForSeoBot/i;

const BOT_BLOCKING_ENABLED = process.env.BOT_BLOCKING_ENABLED !== "false";

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

	if (BOT_BLOCKING_ENABLED) {
		const ua = request.headers.get("user-agent") ?? "";
		if (BLOCKED_BOTS.test(ua)) {
			return new NextResponse("Forbidden", { status: 403 });
		}
	}

	const canonicalTarget = canonicalPediaTarget(request.nextUrl);
	if (canonicalTarget) {
		return NextResponse.redirect(
			new URL(canonicalTarget, request.nextUrl),
			308,
		);
	}

	let segments: string[];
	try {
		segments = decodeURIComponent(pathname).split("/").filter(Boolean);
	} catch {
		return undefined;
	}
	const parashaTarget = canonicalParashaTarget(segments);
	if (parashaTarget) {
		const destination = new URL(parashaTarget, request.nextUrl);
		// Reader-mode and content-selection params survive the redirect.
		destination.search = request.nextUrl.search;
		return NextResponse.redirect(destination, 308);
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

	return undefined;
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
