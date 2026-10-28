import { createServerFn } from "@tanstack/react-start";

/**
 * Post-commit invalidation of the public website's content caches.
 *
 * The website caches all DB-backed content indefinitely
 * (`unstable_cache` with `revalidate: false`) and prerenders pages, so a
 * committed admin change only becomes public after `POST /api/revalidate`
 * expires the relevant tag/path. Each mutation server function enqueues
 * its change after the transaction commits; inside the transaction the
 * website could re-render with pre-commit data and re-cache it stale.
 *
 * Two payload shapes (keep `EntityChange` in sync with
 * web/bible-on-site/src/lib/revalidate/contract.ts):
 *
 * - `changes` — the admin-only entity-change events, posted as a JSON body.
 *   The website owns the dependency index and resolves each change to the
 *   entity-scoped cache tags and route paths that consume it; the admin
 *   names entities (with the destroyed side of renames/moves/deletes it
 *   alone still knows), never routes or tags.
 * - `tag`/`path`/`type` — the legacy query-parameter requests, still sent
 *   as query params for operator-style call sites.
 *
 * Debounce: enqueued requests merge into one flush per DEBOUNCE_MS window
 * (a burst of edits across entity screens becomes a handful of website
 * calls instead of a regeneration stampede), and each call resolves when
 * the flush carrying its requests completes. Requests that fail delivery
 * move to `pendingRetry` and ride along with the NEXT flush — recorded on
 * `lastRevalidationFailure` until then so the editor UI can warn that the
 * public site may still be stale.
 *
 * shortcut: per-instance queue state, accurate on the single admin ECS
 * task; a durable DB-backed `website_revalidate_queue` (surviving task
 * replacement) is remaining scope requiring a schema deployment.
 *
 * Configured by `VITE_WEBSITE_URL` + `REVALIDATE_SECRET`; unset means
 * "no website to invalidate" (unit tests, tooling) and becomes a no-op.
 * The secret must stay server-only — never a `VITE_*` variable, which Vite
 * inlines into the browser bundle — and travels in the
 * `x-revalidate-secret` request header, not the URL, so it stays out of
 * access logs on the plaintext cluster hop.
 */

/** A pasuk-granular span of article covering-source rows (#2189). */
export interface ArticleCoveringSpan {
	perekId: number;
	pasukFrom: number;
	pasukTo: number;
}

/** Mirrors website `EntityChange` — the dependency contract the site owns. */
export type EntityChange =
	| {
			kind: "article";
			id: number;
			/** Old ∪ new primary perek ids. */
			perekIds: number[];
			/** Old ∪ new tanah_article.author_id. */
			authorIds?: number[];
			/** Covering spans destroyed by the change (replaced/removed side). */
			coveringSpans?: ArticleCoveringSpan[];
	  }
	| {
			kind: "author";
			id: number;
			name: string;
			oldName?: string;
	  }
	| {
			kind: "pedia-entry";
			uniqueName: string;
			oldUniqueName?: string;
			entityTypes?: string[];
			synonymNames?: string[];
			refPerekIds?: number[];
	  }
	| {
			kind: "pedia-entity";
			entityId: string;
			entityType?: string;
			entryUniqueNames?: string[];
			refPerekIds?: number[];
	  }
	| {
			kind: "pedia-entries";
			uniqueNames: string[];
			entityTypes?: string[];
			refPerekIds?: number[];
	  }
	| {
			kind: "dedication";
			/** tanah_dedication.id — survives edits/deletes. */
			id: number;
			/** Old ∪ new assignments (#2731); the website maps them to scoped tags/paths. */
			perekRanges?: { low: number; high: number }[];
			seferIds?: number[];
			helekIds?: number[];
			parashaIds?: number[];
			articleIds?: number[];
			/** Canonical tanahpedia_entry ids of entry-scoped assignments. */
			entryIds?: string[];
			/** True when the dedication carries the whole-masora scope. */
			masora?: boolean;
	  };

export interface RevalidateRequest {
	/** Typed entity changes — posted as the `{changes}` JSON body. */
	changes?: EntityChange[];
	tag?: string;
	path?: string;
	/** `page` | `layout`; patterns default to `page` on the website. */
	type?: "page" | "layout";
	/**
	 * Site-relative public paths whose content changed. Sent as `url` query
	 * params — the website submits them to IndexNow once invalidation
	 * succeeds. Entity changes rarely need this: the dependency resolver
	 * enumerates the changed paths itself.
	 */
	urls?: string[];
}

const TIMEOUT_MS = 5000;
/** Burst window: requests enqueued together flush as one website call set. */
const DEBOUNCE_MS = 300;
/** Keep in sync with MAX_CHANGES_PER_REQUEST on the website contract. */
const MAX_CHANGES_PER_REQUEST = 64;

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
	for (const url of request.urls ?? []) query.append("url", url);
	const url = `${base}/api/revalidate?${query}`;
	const hasChanges = (request.changes?.length ?? 0) > 0;
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"x-revalidate-secret": secret,
				...(hasChanges
					? { "content-type": "application/json" }
					: {}),
			},
			...(hasChanges
				? { body: JSON.stringify({ changes: request.changes }) }
				: {}),
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
	/** ISO timestamp of the most recent failed flush. */
	failedAt: string;
	/** The requests still unapplied (retried on the next flush). */
	requests: RevalidateRequest[];
}

/**
 * Queue state: `queued` holds requests awaiting the next flush;
 * `pendingRetry` holds requests whose delivery failed — they prepend the
 * next batch so a transient website outage cannot silently lose an
 * invalidation, and `lastFailure` mirrors them until they apply.
 */
let queued: RevalidateRequest[] = [];
let pendingRetry: RevalidateRequest[] = [];
let lastFailure: RevalidationFailure | null = null;
let draining = false;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Callers awaiting the flush that carries the current generation. */
let generation: { resolvers: ((applied: boolean) => void)[] } | null = null;

export function lastRevalidationFailure(): RevalidationFailure | null {
	return lastFailure;
}

/**
 * Test hook — clears the queue, retry backlog, status and the pending
 * generation so one test's failed delivery cannot ride the next test's
 * flush. Production callers never need this: `pendingRetry` is the
 * correctness mechanism keeping invalidations alive across outages.
 */
export function __resetRevalidateForTests(): void {
	queued = [];
	pendingRetry = [];
	lastFailure = null;
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	const leftover = generation;
	generation = null;
	for (const resolve of leftover?.resolvers ?? []) {
		resolve(true);
	}
}

/** Editor-facing freshness status polled by the revalidation warning. */
export const getWebsiteRevalidationStatus = createServerFn({
	method: "GET",
}).handler(async (): Promise<{ lastFailure: RevalidationFailure | null }> => {
	return { lastFailure };
});

/**
 * Split a flush into posts: change requests merge into `{changes}` bodies
 * of at most MAX_CHANGES_PER_REQUEST entries (their `urls` ride the first
 * chunk); legacy tag/path requests keep one query-parameter post each.
 */
function batchToPosts(batch: RevalidateRequest[]): RevalidateRequest[] {
	const changes = batch.flatMap((request) => request.changes ?? []);
	const urls = batch.flatMap((request) => request.urls ?? []);
	const posts: RevalidateRequest[] = [];
	for (let i = 0; i < changes.length; i += MAX_CHANGES_PER_REQUEST) {
		posts.push({
			changes: changes.slice(i, i + MAX_CHANGES_PER_REQUEST),
			...(i === 0 && urls.length > 0 ? { urls } : {}),
		});
	}
	for (const request of batch) {
		if (request.changes?.length) continue;
		posts.push({
			tag: request.tag,
			path: request.path,
			type: request.type,
			...(changes.length === 0 && request.urls?.length
				? { urls: request.urls }
				: {}),
		});
	}
	return posts;
}

async function drain(): Promise<void> {
	if (draining) return;
	draining = true;
	// Retried posts ride the first batch only — re-queueing them into the
	// loop would hot-retry a dead website forever.
	let includeRetry = true;
	try {
		while (queued.length > 0 || (includeRetry && pendingRetry.length > 0)) {
			const batch = includeRetry
				? [...pendingRetry, ...queued]
				: [...queued];
			includeRetry = false;
			pendingRetry = [];
			queued = [];
			const waiting = generation;
			generation = null;
			const posts = batchToPosts(batch);
			const outcomes = await Promise.all(
				posts.map(async (post) => ({
					post,
					outcome: await postRevalidate(post),
				})),
			);
			const failed = outcomes
				.filter((o) => o.outcome === "failed")
				.map((o) => o.post);
			if (failed.length > 0) {
				pendingRetry.push(...failed);
				lastFailure = {
					failedAt: new Date().toISOString(),
					requests: [...pendingRetry],
				};
			} else {
				lastFailure = null;
			}
			const applied = outcomes.every(
				(outcome) => outcome.outcome === "applied",
			);
			for (const resolve of waiting?.resolvers ?? []) {
				resolve(failed.length === 0 && applied);
			}
		}
		// Nothing flushed (e.g. an empty enqueue) — the generation's callers
		// still need their promise resolved.
		const leftover = generation;
		generation = null;
		for (const resolve of leftover?.resolvers ?? []) {
			resolve(pendingRetry.length === 0);
		}
	} finally {
		draining = false;
	}
}

/**
 * Enqueue invalidation work for the debounced flush. Resolves `true` when
 * the flush carrying these requests fully applied; `false` while stale
 * content is still pending (failed requests retry on the next flush and
 * remain visible via `getWebsiteRevalidationStatus`).
 */
export function revalidateWebsite(
	requests: RevalidateRequest[],
): Promise<boolean> {
	queued.push(...requests);
	if (!generation) generation = { resolvers: [] };
	const current = generation;
	const waiting = new Promise<boolean>((resolve) =>
		current.resolvers.push(resolve),
	);
	if (!timer && !draining) {
		timer = setTimeout(() => {
			timer = null;
			void drain();
		}, DEBOUNCE_MS);
		timer.unref?.();
	}
	return waiting;
}

/**
 * Public path of an article page (`/929/<perek>/<article>`) — kept for
 * operator/manual `urls` use. Entity changes derive their own paths.
 */
export function articlePath(perekId: number, articleId: number): string {
	return `/929/${perekId}/${articleId}`;
}

/**
 * Public path of an author page. Keep the slug rule in sync with the
 * website's `authorNameToSlug` (web/bible-on-site/src/util/slug.ts):
 * strip geresh/gershayim/quote characters, trim, then percent-encode.
 */
export function authorPath(name: string): string {
	return `/929/authors/${encodeURIComponent(name.replace(/["׳']/g, "").trim())}`;
}

/** Public path of a pedia entry page (`/pedia/<unique_name>`). */
export function pediaEntryPath(uniqueName: string): string {
	return `/pedia/${uniqueName}`;
}

/**
 * Every page that renders article data carries the `articles` tag; `urls`
 * lists the article pages (and their old locations after a move) whose
 * content changed.
 */
export function articleInvalidation(...urls: string[]): RevalidateRequest[] {
	return [{ tag: "articles", ...(urls.length ? { urls } : {}) }];
}

/**
 * Author names and details render on author pages and inside article
 * pages/lists, so both tags must expire on an author change. `urls` lists
 * the changed author pages (old slug included after a rename).
 */
export function authorInvalidation(...urls: string[]): RevalidateRequest[] {
	return [
		{ tag: "authors" },
		{ tag: "articles", ...(urls.length ? { urls } : {}) },
	];
}

/**
 * Pedia entry/category/disambiguation pages are prerendered under the
 * `/pedia/[slug]` route file, the index at `/pedia`, and per-perek entity
 * references on `tanahpedia-entity-refs`-tagged caches, and resolved
 * mention decorations (#2516) on `tanahpedia-mention-refs` — entry
 * create/rename/delete must expire both so decorations appear/disappear
 * without re-running inference. `urls` lists the entry pages whose
 * content changed (old unique names included after a rename).
 */
export function pediaInvalidation(...urls: string[]): RevalidateRequest[] {
	return [
		{ tag: "tanahpedia-entity-refs" },
		{ path: "/pedia/[slug]", type: "page" },
		{ path: "/pedia", ...(urls.length ? { urls } : {}) },
		{ tag: "tanahpedia-mention-refs" },
	];
}

// --- typed-change builders --------------------------------------------------

/**
 * Merge single-pasuk covering rows (`{perek_id, pasuk}`) into contiguous
 * spans for the `coveringSpans` field — a long covered section stays a
 * handful of ranges instead of hundreds of single-verse entries.
 */
export function mergeCoveringSpans(
	rows: { perek_id: number; pasuk: number }[],
): ArticleCoveringSpan[] {
	const sorted = [...rows].sort(
		(a, b) => a.perek_id - b.perek_id || a.pasuk - b.pasuk,
	);
	const spans: ArticleCoveringSpan[] = [];
	for (const row of sorted) {
		const last = spans[spans.length - 1];
		if (
			last &&
			last.perekId === row.perek_id &&
			row.pasuk <= last.pasukTo + 1
		) {
			last.pasukTo = Math.max(last.pasukTo, row.pasuk);
		} else {
			spans.push({
				perekId: row.perek_id,
				pasukFrom: row.pasuk,
				pasukTo: row.pasuk,
			});
		}
	}
	return spans;
}

/** An article create/update/move/delete — `perekIds`/`authorIds` are old ∪ new. */
export function articleChange(input: {
	id: number;
	perekIds: number[];
	authorIds?: number[];
	coveringSpans?: ArticleCoveringSpan[];
}): RevalidateRequest {
	return {
		changes: [
			{
				kind: "article",
				id: input.id,
				perekIds: input.perekIds,
				...(input.authorIds ? { authorIds: input.authorIds } : {}),
				...(input.coveringSpans
					? { coveringSpans: input.coveringSpans }
					: {}),
			},
		],
	};
}

/** An author create/update/delete — `oldName` carries a rename's old slug. */
export function authorChange(input: {
	id: number;
	name: string;
	oldName?: string;
}): RevalidateRequest {
	return {
		changes: [
			{
				kind: "author",
				id: input.id,
				name: input.name,
				...(input.oldName ? { oldName: input.oldName } : {}),
			},
		],
	};
}

/**
 * A pedia entry create/update/rename/delete. `uniqueName` is the name after
 * the change (the deleted name on delete); `oldUniqueName` carries the
 * pre-commit name on renames. For deletes the caller should prefer
 * `pediaChangesForEntryIds` (server/tanahpedia/paths.ts), which captures
 * the entity types, synonyms and source perakim while the row still
 * exists — after the delete they are unresolvable.
 */
/**
 * A dedication create/update/delete (#2731). The caller supplies the old ∪
 * new assignment set — gathered pre-commit on deletes, post-commit
 * otherwise — and the website's dependency resolver maps it to the scoped
 * dedication tags and pages.
 */
export function dedicationChange(input: {
	id: number;
	perekRanges?: { low: number; high: number }[];
	seferIds?: number[];
	helekIds?: number[];
	parashaIds?: number[];
	articleIds?: number[];
	entryIds?: string[];
	masora?: boolean;
}): RevalidateRequest {
	return {
		changes: [
			{
				kind: "dedication",
				id: input.id,
				...(input.perekRanges?.length ? { perekRanges: input.perekRanges } : {}),
				...(input.seferIds?.length ? { seferIds: input.seferIds } : {}),
				...(input.helekIds?.length ? { helekIds: input.helekIds } : {}),
				...(input.parashaIds?.length ? { parashaIds: input.parashaIds } : {}),
				...(input.articleIds?.length ? { articleIds: input.articleIds } : {}),
				...(input.entryIds?.length ? { entryIds: input.entryIds } : {}),
				...(input.masora ? { masora: true } : {}),
			},
		],
	};
}

export function pediaEntryChange(input: {
	uniqueName: string;
	oldUniqueName?: string;
	entityTypes?: string[];
	synonymNames?: string[];
	refPerekIds?: number[];
}): RevalidateRequest {
	return {
		changes: [
			{
				kind: "pedia-entry",
				uniqueName: input.uniqueName,
				...(input.oldUniqueName
					? { oldUniqueName: input.oldUniqueName }
					: {}),
				...(input.entityTypes
					? { entityTypes: input.entityTypes }
					: {}),
				...(input.synonymNames
					? { synonymNames: input.synonymNames }
					: {}),
				...(input.refPerekIds
					? { refPerekIds: input.refPerekIds }
					: {}),
			},
		],
	};
}
