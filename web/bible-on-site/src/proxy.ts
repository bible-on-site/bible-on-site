import { type NextRequest, NextResponse } from "next/server";
import {
	pediaPathFromLegacy,
	resolveCategoryRoute,
} from "@/lib/tanahpedia/category-slug";

const BLOCKED_BOTS =
	/Bytespider|MJ12bot|AhrefsBot|SemrushBot|DotBot|PetalBot|BLEXBot|MegaIndex|Sogou|DataForSeoBot/i;

const BOT_BLOCKING_ENABLED = process.env.BOT_BLOCKING_ENABLED !== "false";

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

	if (root === "tanahpedia")
		return pediaPathFromLegacy(second ?? null, filters);
	if (!second) return null;

	const resolved = resolveCategoryRoute(second, filters);
	if (!resolved) return null;

	const hasFilters =
		Boolean(filters.role) || Boolean(filters.kind) || Boolean(filters.purity);
	return !resolved.isCanonicalSlug || hasFilters ? resolved.canonicalPath : null;
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

	return undefined;
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
