import { revalidatePath, revalidateTag } from "next/cache";
import { after, type NextRequest, NextResponse } from "next/server";
import { collectSubmissionPaths, submitIndexNow } from "@/lib/seo/indexnow";

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
 * - `url` (repeatable): a site-relative public path whose content changed
 *   (e.g. `/929/5/12`, `/pedia/משה`). After successful invalidation the
 *   collected URLs — a literal `path` included — are submitted to IndexNow
 *   once the response completes. A call carrying only `url` params performs
 *   no invalidation and serves as the operator path for bulk/data changes.
 *
 * The secret is required in production (`REVALIDATE_SECRET`). Send it in the
 * `x-revalidate-secret` header — the admin caller does this so the secret
 * stays out of URLs (and therefore out of access logs on the cluster's
 * plaintext hop). A `?secret=` query parameter is still accepted for
 * operator/manual calls.
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
	const urls = searchParams.getAll("url");
	// Header first — callers should never put the secret in the URL; the
	// query parameter remains for operator/manual calls.
	const secret =
		request.headers.get("x-revalidate-secret") ?? searchParams.get("secret");

	// Validate secret in production
	if (process.env.NODE_ENV === "production") {
		const expectedSecret = process.env.REVALIDATE_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
		}
	}

	if (!path && !tag && urls.length === 0) {
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
	if (urls.some((url) => !url.startsWith("/") || url.startsWith("//"))) {
		return NextResponse.json({ error: "Invalid url" }, { status: 400 });
	}

	try {
		if (tag) {
			revalidateTag(tag, { expire: 0 });
		}

		if (path) {
			revalidatePath(path, type ?? undefined);
		}

		// Notify IndexNow only after invalidation succeeded: a literal
		// `path` is itself a changed public URL; dynamic patterns cannot be
		// enumerated and are left to `collectSubmissionPaths` to drop.
		const notifyPaths = [
			...(path !== null && !path.includes("[") ? [path] : []),
			...urls,
		];
		after(() => submitIndexNow(collectSubmissionPaths(notifyPaths)));

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
