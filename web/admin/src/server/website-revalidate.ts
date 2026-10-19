/**
 * Post-commit invalidation of the public website's content caches.
 *
 * The website caches all DB-backed content indefinitely
 * (`unstable_cache` with `revalidate: false`) and prerenders pages, so a
 * committed admin change only becomes public after `POST /api/revalidate`
 * expires the relevant tag/path. Each mutation server function calls this
 * after its transaction commits; inside the transaction the website could
 * re-render with pre-commit data and re-cache it stale.
 *
 * Best-effort: a failed or unconfigured call is logged and reported as
 * `false`, never thrown, so a committed save must not turn into an error.
 * The committed change then stays stale until a later edit or an operator
 * POSTs `/api/revalidate` on the website directly (production requires the
 * `REVALIDATE_SECRET` provisioned on the website task).
 *
 * Configured by `VITE_WEBSITE_URL` + `VITE_REVALIDATION_SECRET`; unset means
 * "no website to invalidate" (unit tests, tooling) and becomes a no-op.
 */
export interface RevalidateRequest {
	tag?: string;
	path?: string;
	/** `page` | `layout`, required when `path` is a dynamic route pattern. */
	type?: "page" | "layout";
}

const TIMEOUT_MS = 5000;

async function postRevalidate(request: RevalidateRequest): Promise<boolean> {
	const base = process.env.VITE_WEBSITE_URL?.replace(/\/+$/, "");
	const secret = process.env.VITE_REVALIDATION_SECRET;
	if (!base || !secret) {
		console.warn(
			"website revalidation skipped: VITE_WEBSITE_URL/VITE_REVALIDATION_SECRET not configured",
		);
		return false;
	}
	const query = new URLSearchParams({ secret });
	if (request.tag) query.set("tag", request.tag);
	if (request.path) query.set("path", request.path);
	if (request.type) query.set("type", request.type);
	const url = `${base}/api/revalidate?${query}`;
	try {
		const response = await fetch(url, {
			method: "POST",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!response.ok) {
			console.error(
				`website revalidation failed: HTTP ${response.status}`,
				request,
			);
			return false;
		}
		return true;
	} catch (error) {
		console.error("website revalidation request failed", request, error);
		return false;
	}
}

/**
 * Expires/invalidate the given website cache tags and paths in parallel.
 * `true` only when every request was accepted; a partial failure still
 * applied the calls that succeeded.
 */
export async function revalidateWebsite(
	requests: RevalidateRequest[],
): Promise<boolean> {
	const results = await Promise.all(requests.map(postRevalidate));
	return results.every(Boolean);
}

/** Every page that renders article data carries the `articles` tag. */
export const ARTICLE_INVALIDATION: RevalidateRequest[] = [
	{ tag: "articles" },
];

/**
 * Author names and details render on author pages and inside article
 * pages/lists, so both tags must expire on an author change.
 */
export const AUTHOR_INVALIDATION: RevalidateRequest[] = [
	{ tag: "authors" },
	{ tag: "articles" },
];

/**
 * Pedia entry/category/disambiguation pages are prerendered under the
 * `/pedia/[slug]` route file, the index at `/pedia`, and per-perek entity
 * references on `tanahpedia-entity-refs`-tagged caches.
 */
export const PEDIA_INVALIDATION: RevalidateRequest[] = [
	{ tag: "tanahpedia-entity-refs" },
	{ path: "/pedia/[slug]", type: "page" },
	{ path: "/pedia" },
];
