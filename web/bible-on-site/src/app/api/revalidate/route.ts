import { revalidatePath, revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

/**
 * On-demand invalidation for public content caches.
 *
 * Freshness contract: DB-backed reads are cached indefinitely
 * (`unstable_cache` with `revalidate: false`) and content pages are
 * prerendered, so a content change only becomes public when the admin app
 * calls this endpoint after commit.
 *
 * Query parameters:
 * - `path`: a site-relative route to invalidate (e.g. `/929/5`). A dynamic
 *   route pattern (e.g. `/pedia/[slug]`) additionally requires `type`.
 * - `type`: `page` | `layout`, forwarded to `revalidatePath`.
 * - `tag`: a cache tag to expire (e.g. `articles`, `authors`, `perushim`,
 *   `tanahpedia-entity-refs`). `path` and `tag` may be combined in one call.
 * - `secret`: required in production (`REVALIDATE_SECRET`).
 *
 * Tags are expired with `{ expire: 0 }` rather than the "max" profile: the
 * next request blocks on a fresh render instead of being served stale content
 * while it regenerates, so the editor sees the change on the first reload.
 *
 * Note: invalidation is local to the instance that receives the call; with
 * multiple ECS tasks, the call must reach each of them (or a shared cache
 * handler must propagate tag state) for fresh content to be consistent.
 */
export async function POST(request: NextRequest) {
	const searchParams = request.nextUrl.searchParams;
	const path = searchParams.get("path");
	const type = searchParams.get("type");
	const tag = searchParams.get("tag");
	const secret = searchParams.get("secret");

	// Validate secret in production
	if (process.env.NODE_ENV === "production") {
		const expectedSecret = process.env.REVALIDATE_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
		}
	}

	if (!path && !tag) {
		return NextResponse.json(
			{ error: "Either path or tag parameter is required" },
			{ status: 400 },
		);
	}
	if (path !== null && !path.startsWith("/")) {
		return NextResponse.json({ error: "Invalid path" }, { status: 400 });
	}
	if (type !== null && type !== "page" && type !== "layout") {
		return NextResponse.json({ error: "Invalid type" }, { status: 400 });
	}

	try {
		if (tag) {
			revalidateTag(tag, { expire: 0 });
		}

		if (path) {
			revalidatePath(path, type ?? undefined);
		}

		return NextResponse.json({
			revalidated: true,
			...(tag ? { tag } : {}),
			...(path ? { path } : {}),
			...(type ? { type } : {}),
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Revalidation error:", error);
		return NextResponse.json(
			{ error: "Failed to revalidate" },
			{ status: 500 },
		);
	}
}
