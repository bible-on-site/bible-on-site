import { revalidatePath, revalidateTag } from "next/cache";
import { after, type NextRequest, NextResponse } from "next/server";
import {
	ChangeValidationError,
	parseEntityChanges,
} from "@/lib/revalidate/contract";
import {
	type ResolvedInvalidation,
	resolveEntityChanges,
} from "@/lib/revalidate/dependencies";
import { collectSubmissionPaths, submitIndexNow } from "@/lib/seo/indexnow";

/**
 * On-demand invalidation for public content caches.
 *
 * Freshness contract: DB-backed reads are cached indefinitely
 * (`unstable_cache` with `revalidate: false`) and content pages are
 * prerendered, so a content change only becomes public when the admin app
 * calls this endpoint after commit.
 *
 * Two ingress shapes:
 *
 * - JSON body `{ "changes": EntityChange[] }` — the admin-server contract.
 *   The website owns the dependency index and resolves each change to the
 *   entity-scoped cache tags and route paths whose output consumes it
 *   (see `src/lib/revalidate/`). The admin names entities, never routes.
 *
 * - Query parameters (operator/manual path, kept for compatibility):
 *   - `path`: a site-relative route to invalidate (e.g. `/929/5`). A dynamic
 *     route pattern (e.g. `/pedia/[slug]`) defaults `type` to `page`.
 *   - `type`: `page` | `layout`, forwarded to `revalidatePath`.
 *   - `tag`: a cache tag to expire (e.g. `articles`, `authors`, `perushim`,
 *     `tanahpedia-entity-refs`). `path` and `tag` may be combined in one call.
 *   - `url` (repeatable): a site-relative public path whose content changed
 *     (e.g. `/929/5/12`, `/pedia/משה`). After successful invalidation the
 *     collected URLs — resolved dependency paths and a literal `path`
 *     included — are submitted to IndexNow once the response completes. A
 *     call carrying only `url` params performs no invalidation and serves
 *     as the operator path for bulk/data changes.
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
 * Revalidation itself is lazy — a `revalidateTag`/`revalidatePath` call marks
 * the entry stale; the HTML is rebuilt on the next visit to that route, not
 * eagerly inside this request.
 *
 * Note: invalidation is local to the instance that receives the call; with
 * multiple ECS tasks, the call must reach each of them (or a shared cache
 * handler must propagate tag state) for fresh content to be consistent.
 */

/** Body byte bound — a legitimate batch is a few KB of entity changes. */
const MAX_BODY_BYTES = 64 * 1024;

interface InvalidationWork {
	tags: string[];
	paths: string[];
	patterns: { path: string; type: "page" | "layout" }[];
	urls: string[];
}

function applyInvalidation(work: InvalidationWork) {
	for (const tag of work.tags) {
		revalidateTag(tag, { expire: 0 });
	}
	for (const path of work.paths) {
		revalidatePath(path);
	}
	for (const pattern of work.patterns) {
		revalidatePath(pattern.path, pattern.type);
	}
}

export async function POST(request: NextRequest) {
	const searchParams = request.nextUrl.searchParams;
	// Header first — callers should never put the secret in the URL; the
	// query parameter remains for operator/manual calls.
	const secret =
		request.headers.get("x-revalidate-secret") ?? searchParams.get("secret");

	// Validate secret in production — before any parsing or side effects.
	if (process.env.NODE_ENV === "production") {
		const expectedSecret = process.env.REVALIDATE_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
		}
	}

	const path = searchParams.get("path");
	const type = searchParams.get("type");
	const tag = searchParams.get("tag");
	const urls = searchParams.getAll("url");

	if (path !== null && !path.startsWith("/")) {
		return NextResponse.json({ error: "Invalid path" }, { status: 400 });
	}
	if (type !== null && type !== "page" && type !== "layout") {
		return NextResponse.json({ error: "Invalid type" }, { status: 400 });
	}
	// Narrowed for the patterns array below — the check above guarantees it.
	const pathType: "page" | "layout" | null =
		type === "page" || type === "layout" ? type : null;
	if (urls.some((url) => !url.startsWith("/") || url.startsWith("//"))) {
		return NextResponse.json({ error: "Invalid url" }, { status: 400 });
	}

	// Typed entity changes arrive as a JSON body; resolve them through the
	// website-owned dependency index.
	let resolved: ResolvedInvalidation | null = null;
	if (request.headers.get("content-type")?.includes("application/json")) {
		const bodySize = Number(request.headers.get("content-length") ?? 0);
		if (bodySize > MAX_BODY_BYTES) {
			return NextResponse.json(
				{ error: "Request body too large" },
				{ status: 400 },
			);
		}
		let body: unknown;
		try {
			// content-length may be absent on chunked uploads — bound the
			// decoded text too so an unbounded body cannot reach the parser.
			const bodyText = await request.text();
			if (bodyText.length > MAX_BODY_BYTES) {
				return NextResponse.json(
					{ error: "Request body too large" },
					{ status: 400 },
				);
			}
			body = JSON.parse(bodyText);
		} catch {
			return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
		}
		let changes: ReturnType<typeof parseEntityChanges>;
		try {
			changes = parseEntityChanges(body);
		} catch (error) {
			if (error instanceof ChangeValidationError) {
				return NextResponse.json(
					{ error: error.message },
					{ status: 400 },
				);
			}
			throw error;
		}
		try {
			resolved = await resolveEntityChanges(changes);
		} catch (error) {
			console.error("Dependency resolution failed:", error);
			return NextResponse.json(
				{ error: "Failed to resolve entity dependencies" },
				{ status: 500 },
			);
		}
	}

	if (
		!path &&
		!tag &&
		urls.length === 0 &&
		(resolved === null ||
			(resolved.tags.length === 0 &&
				resolved.paths.length === 0 &&
				resolved.patterns.length === 0))
	) {
		return NextResponse.json(
			{ error: "Either path or tag parameter is required" },
			{ status: 400 },
		);
	}

	try {
		const work: InvalidationWork = {
			tags: [...(resolved?.tags ?? []), ...(tag ? [tag] : [])],
			paths: [
				...(resolved?.paths ?? []),
				...(path && !path.includes("[") ? [path] : []),
			],
			patterns: [
				...(resolved?.patterns ?? []),
				...(path?.includes("[")
					? [{ path, type: pathType ?? "page" }]
					: []),
			],
			urls: [...(resolved?.urls ?? []), ...urls],
		};
		applyInvalidation(work);

		// Notify IndexNow only after invalidation succeeded: a literal
		// `path` is itself a changed public URL; resolved dependency paths
		// and dynamic patterns cannot be enumerated further here.
		const notifyPaths = collectSubmissionPaths([
			...(path !== null && !path.includes("[") ? [path] : []),
			...work.urls,
		]);
		after(() => submitIndexNow(notifyPaths));

		return NextResponse.json({
			revalidated: true,
			...(tag ? { tag } : {}),
			...(path ? { path } : {}),
			...(type ? { type } : {}),
			...(resolved
				? {
						resolved: {
							tags: resolved.tags.length,
							paths: resolved.paths.length,
							patterns: resolved.patterns.length,
						},
					}
				: {}),
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
