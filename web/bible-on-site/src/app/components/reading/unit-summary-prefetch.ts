import type { ArticleSummary } from "@/lib/articles";
import type { RangePerushSummary } from "@/lib/perushim";
import type { DivisionId } from "@/lib/reading/contract";
import type { UnitBookScope } from "./unit-book-content";

/**
 * Hand-off from the sefer-book batch loader to the flat unit pages'
 * per-unit cached loaders. `getUnitScopeSummariesBatch` resolves a whole
 * sefer's summaries with two grouped queries; priming this store lets each
 * unit's `unstable_cache` loader reuse that result on its first
 * (cache-miss) read instead of issuing the same query again — a book open
 * warms the flat pages without the per-unit fan-out the grouped queries
 * replaced.
 *
 * Entries are single-use per kind and expire after PREFETCH_TTL_MS, so a
 * content change between the book open and the unit navigation cannot pin
 * stale summaries into the persistent cache; any miss runs the loader's
 * own query, which is also what happens on server instances that never
 * saw the batch. State lives on `globalThis` under a Symbol because the
 * server-action bundle and the page-render bundle do not share module
 * instances (same pattern as src/lib/recitation-response.ts).
 */

/** How long a primed entry stays consumable after the book fetch. */
const PREFETCH_TTL_MS = 2 * 60 * 1000;

export interface UnitSummaryPair {
	articles: ArticleSummary[];
	perushim: RangePerushSummary[];
}

interface PrefetchEntry {
	expires: number;
	articles?: unknown[];
	perushim?: unknown[];
}

const storeKey = Symbol.for("bible-on-site.unit-summary-prefetch");
const server = globalThis as typeof globalThis & {
	[storeKey]?: Map<string, PrefetchEntry>;
};

function entries(): Map<string, PrefetchEntry> {
	let map = server[storeKey];
	if (!map) {
		map = new Map();
		server[storeKey] = map;
	}
	return map;
}

/**
 * Registry key mirroring the flat loaders' cache identity: parasha units
 * key on division+scope, masora units on division alone (their pages
 * serve only the torah scope). Other divisions/scopes have no flat
 * loader and are never primed.
 */
function prefetchKey(
	division: DivisionId,
	unitId: number,
	scope: UnitBookScope,
): string | null {
	if (division === "parasha") return `parasha:${unitId}:${scope}`;
	if (division === "masora" && scope === "torah") return `masora:${unitId}`;
	return null;
}

/**
 * Stores one book batch's per-unit summaries for the flat loaders.
 * Called only after the grouped queries succeed — a failed batch must
 * never seed empty summaries into the persistent cache.
 */
export function primeUnitSummaries(
	division: DivisionId,
	scope: UnitBookScope,
	unitIds: number[],
	summaries: Record<string, UnitSummaryPair>,
): void {
	const map = entries();
	const now = Date.now();
	for (const [key, entry] of map) {
		if (entry.expires < now) map.delete(key);
	}
	const expires = now + PREFETCH_TTL_MS;
	for (const unitId of unitIds) {
		const key = prefetchKey(division, unitId, scope);
		const summary = key === null ? undefined : summaries[String(unitId)];
		if (key === null || summary === undefined) continue;
		map.set(key, {
			expires,
			articles: summary.articles,
			perushim: summary.perushim,
		});
	}
}

/**
 * Consumes a primed summary for one unit/scope/kind — invoked inside the
 * `unstable_cache` loaders, so it runs only on a cache miss. Each kind is
 * single-use; the entry disappears once both kinds are consumed or it
 * expires, and any miss falls through to the loader's own query.
 */
export function takeUnitSummaryPrefetch<T>(
	key: string,
	kind: "articles" | "perushim",
): T[] | undefined {
	const map = server[storeKey];
	const entry = map?.get(key);
	if (!map || !entry) return undefined;
	if (entry.expires < Date.now()) {
		map.delete(key);
		return undefined;
	}
	const value = entry[kind] as T[] | undefined;
	delete entry[kind];
	if (entry.articles === undefined && entry.perushim === undefined) {
		map.delete(key);
	}
	return value;
}

/**
 * Drops every primed entry. The revalidate route calls this on each
 * invalidation so a post-edit read can never consume a pre-edit prime
 * into the persistent cache — the TTL alone cannot see tag expiry.
 */
export function clearUnitSummaryPrefetch(): void {
	server[storeKey]?.clear();
}
