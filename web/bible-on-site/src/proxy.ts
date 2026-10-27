import { type NextRequest, NextResponse } from "next/server";
import bookPageSlugs from "@/data/book-page-slugs.json";
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
