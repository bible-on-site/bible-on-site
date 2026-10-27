import { unstable_cache } from "next/cache";

/**
 * The website-owned cache tag vocabulary for entity-dependent content.
 *
 * Two tag granularities exist per cached loader:
 * - the broad COLLECTION tag (`articles`, `perushim`, …) — the operator
 *   escape hatch; expiring it invalidates every entry of that family.
 *   Routine admin events never send these; the dependency resolver emits
 *   them only as a fallback when a change cannot be resolved precisely.
 * - entity-scoped tags (`article:5`, `perek:12:articles`, …) — emitted by
 *   `resolveEntityChanges` so a committed change expires only the data
 *   and routes that actually consume it.
 *
 * Tags collected during a route's render propagate to the route's cache
 * entry, so expiring `article:5` also invalidates the rendered pages that
 * consumed it — the data cache and the route cache move together.
 */
export const COLLECTION_TAGS = {
	articles: "articles",
	authors: "authors",
	perushim: "perushim",
	pediaEntityRefs: "tanahpedia-entity-refs",
	pediaMentionRefs: "tanahpedia-mention-refs",
	perekImages: "perek-images",
} as const;

/** Article row `id` — `/929/{perek}/{article}` and anywhere it is embedded. */
export const articleTag = (articleId: number) => `article:${articleId}`;

/** Article summaries listed on `/929/{perek}` and in its sefer view. */
export const perekArticlesTag = (perekId: number) =>
	`perek:${perekId}:articles`;

/** Perush summaries listed on `/929/{perek}` and in its sefer view. */
export const perekPerushimTag = (perekId: number) =>
	`perek:${perekId}:perushim`;

/** Full perush detail for `/929/{perek}/{perushName}` views. */
export const perushDetailTag = (perushId: number, perekId: number) =>
	`perush:${perushId}:${perekId}`;

/**
 * Author page data for `/929/authors/{authorParam}` — the param is the
 * normalised-name slug, with the legacy numeric id form still resolving.
 * Resolution emits both forms.
 */
export const authorTag = (authorParam: string) => `author:${authorParam}`;

/** The article list of one author (`/929/authors/{param}` body). */
export const authorArticlesTag = (authorId: number) =>
	`author:${authorId}:articles`;

/** Range article summaries on a parasha unit page (`torah`/`haftara` scope). */
export const parashaArticlesTag = (unitId: number, scope: string) =>
	`parasha:${unitId}:${scope}:articles`;

/** Range perush summaries on a parasha unit page (`torah`/`haftara` scope). */
export const parashaPerushimTag = (unitId: number, scope: string) =>
	`parasha:${unitId}:${scope}:perushim`;

/** Range article summaries on a masora unit page. */
export const masoraArticlesTag = (unitId: number) =>
	`masora:${unitId}:articles`;

/** Range perush summaries on a masora unit page. */
export const masoraPerushimTag = (unitId: number) =>
	`masora:${unitId}:perushim`;

/** Curated tanahpedia entity references rendered inside `/929/{perek}` text. */
export const entityRefsTag = (perekId: number) =>
	`perek:${perekId}:entity-refs`;

/** Resolved mention decorations rendered inside `/929/{perek}` text. */
export const mentionRefsTag = (perekId: number) =>
	`perek:${perekId}:mention-refs`;

/**
 * `unstable_cache` tags are fixed per cache definition, so per-entity
 * invalidation needs one cached function per entity key. This factory
 * memoizes a `unstable_cache` instance per key: `keyOf` derives the
 * entity key (also part of the cache key so entries never collide — the
 * invocation args ride along in the key as well) and `tagsFor` returns
 * its collection + entity tags. A thrown loader error is never cached —
 * the next call re-runs the loader.
 */
export function cachedPerKey<A extends unknown[], R>(
	baseKey: string,
	keyOf: (...args: A) => string,
	tagsFor: (key: string) => string[],
	loader: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
	const instances = new Map<string, (...args: A) => Promise<R>>();
	return (...args: A) => {
		const key = keyOf(...args);
		let fn = instances.get(key);
		if (!fn) {
			fn = unstable_cache((...a: A) => loader(...a), [baseKey, key], {
				tags: tagsFor(key),
				revalidate: false,
			});
			instances.set(key, fn);
		}
		return fn(...args);
	};
}
