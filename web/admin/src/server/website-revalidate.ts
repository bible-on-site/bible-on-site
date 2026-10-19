import { createServerFn } from "@tanstack/react-start";

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
 * Failures are also recorded (see `lastRevalidationFailure`) so the editor
 * UI can warn that the public site may still be stale; the committed change
 * then becomes public on the next successful invalidation or when an
 * operator POSTs `/api/revalidate` on the website directly (production
 * requires the `REVALIDATE_SECRET` provisioned on the website task).
 *
 * Configured by `VITE_WEBSITE_URL` + `REVALIDATE_SECRET`; unset means
 * "no website to invalidate" (unit tests, tooling) and becomes a no-op.
 * The secret must stay server-only — never a `VITE_*` variable, which Vite
 * inlines into the browser bundle — and travels in the
 * `x-revalidate-secret` request header, not the URL, so it stays out of
 * access logs on the plaintext cluster hop.
 */
export interface RevalidateRequest {
	tag?: string;
	path?: string;
	/** `page` | `layout`, required when `path` is a dynamic route pattern. */
	type?: "page" | "layout";
}

const TIMEOUT_MS = 5000;

/**
 * `skipped` = the documented no-op (endpoint not configured), distinct from
 * `failed` so the editor-facing failure record only counts real attempts.
 */
type RevalidateOutcome = "applied" | "failed" | "skipped";

async function postRevalidate(
	request: RevalidateRequest,
): Promise<RevalidateOutcome> {
	const base = process.env.VITE_WEBSITE_URL?.replace(/\/+$/, "");
	const secret = process.env.REVALIDATE_SECRET;
	if (!base || !secret) {
		console.warn(
			"website revalidation skipped: VITE_WEBSITE_URL/REVALIDATE_SECRET not configured",
		);
		return "skipped";
	}
	const query = new URLSearchParams();
	if (request.tag) query.set("tag", request.tag);
	if (request.path) query.set("path", request.path);
	if (request.type) query.set("type", request.type);
	const url = `${base}/api/revalidate?${query}`;
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "x-revalidate-secret": secret },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!response.ok) {
			console.error(
				`website revalidation failed: HTTP ${response.status}`,
				request,
			);
			return "failed";
		}
		return "applied";
	} catch (error) {
		console.error("website revalidation request failed", request, error);
		return "failed";
	}
}

export interface RevalidationFailure {
	/** ISO timestamp of the failed batch. */
	failedAt: string;
	/** The requests that were not applied. */
	requests: RevalidateRequest[];
}

/**
 * The still-unsatisfied invalidations: failed requests from the most recent
 * batch that did not fully apply, `null` when the last batch fully applied
 * (or nothing has run yet). Surfaced to editors via
 * `getWebsiteRevalidationStatus` so a stale public site is visible.
 *
 * shortcut: per-instance module state, accurate on the single admin ECS
 * task; upgrade to shared state (DB/queue) if the admin ever scales out.
 */
let lastFailure: RevalidationFailure | null = null;

export function lastRevalidationFailure(): RevalidationFailure | null {
	return lastFailure;
}

/** Editor-facing freshness status polled by the revalidation warning. */
export const getWebsiteRevalidationStatus = createServerFn({
	method: "GET",
}).handler(async (): Promise<{ lastFailure: RevalidationFailure | null }> => {
	return { lastFailure };
});

/**
 * Expires/invalidate the given website cache tags and paths in parallel.
 * `true` only when every request was accepted; a partial failure still
 * applied the calls that succeeded — the unapplied subset is recorded on
 * `lastRevalidationFailure` until a later batch fully succeeds.
 */
export async function revalidateWebsite(
	requests: RevalidateRequest[],
): Promise<boolean> {
	const settled = await Promise.all(
		requests.map(async (request) => ({
			request,
			outcome: await postRevalidate(request),
		})),
	);
	const failed = settled
		.filter((s) => s.outcome === "failed")
		.map((s) => s.request);
	lastFailure = failed.length
		? { failedAt: new Date().toISOString(), requests: failed }
		: null;
	return settled.every((s) => s.outcome === "applied");
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
