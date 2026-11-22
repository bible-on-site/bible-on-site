/**
 * The typed entity-change contract between the admin server and the
 * website's `/api/revalidate` endpoint — the single definition both
 * consumers import (#3710).
 *
 * The admin identifies *what* changed (entities, their old and new
 * relationships); the website owns *which* rendered output depends on it
 * (see `web/bible-on-site/src/lib/revalidate/dependencies.ts`). Admin never
 * names website routes or cache tags — the route/tag mapping cannot drift
 * out of sync with the pages.
 *
 * Every optional field named `old*` carries the pre-commit relationship
 * for rename/move/delete: after the commit the old edge may no longer be
 * queryable, so it must arrive inside the event itself. Fields that are
 * sets (e.g. `perekIds`, `entryUniqueNames`) hold the union of the old
 * and new relationship — the caller merges across a burst before
 * enqueueing, and the resolver treats them as "any of these".
 *
 * The two apps deploy in independently ordered releases: a new admin may
 * talk to an older website and vice versa. The wire shape therefore
 * evolves additively only — new *optional* fields, never renames or
 * required-field additions (an older receiver's fail-closed validator
 * drops unknown fields but must keep accepting the change).
 *
 * Side ownership stays local: the admin dispatcher (queue, debounce,
 * retry) lives at `web/admin/src/server/website-revalidate.ts`; the
 * website's fail-closed input validation (`parseEntityChanges`) and the
 * route/cache dependency resolution live at
 * `web/bible-on-site/src/lib/revalidate/`.
 */

/** Max entity changes per `{changes}` request body — receiver rejects more. */
export const MAX_CHANGES_PER_REQUEST = 64;

/** A pasuk-granular scripture span of verified article coverage (#2189). */
export interface ArticleCoveringSpan {
	perekId: number;
	pasukFrom: number;
	pasukTo: number;
}

export type EntityChange =
	| {
			kind: "article";
			/** tanah_article.id — survives moves/deletes. */
			id: number;
			/** Old ∪ new primary perek ids the article belongs to. */
			perekIds: number[];
			/** Old ∪ new tanah_article.author_id — author page deps. */
			authorIds?: number[];
			/**
			 * The destroyed side of covering-source coverage: spans that no
			 * longer exist after the commit (replaced/deleted rows, or the
			 * whole set when verification flipped off). The resolver unions
			 * them with the article's live covering rows, so create/update
			 * payloads may omit the surviving side entirely.
			 */
			coveringSpans?: ArticleCoveringSpan[];
	  }
	| {
			kind: "author";
			/** tanah_author.id — resolves the author's articles. */
			id: number;
			/** Current name (the post-commit slug source). */
			name: string;
			/** Pre-commit name when it changed (rename). */
			oldName?: string;
	  }
	| {
			kind: "pedia-entry";
			/** tanahpedia_entry.unique_name after the change. */
			uniqueName: string;
			/** Pre-commit unique_name on rename/delete. */
			oldUniqueName?: string;
			/** Old ∪ new entity types — for category-page deps on delete. */
			entityTypes?: string[];
			/** Old ∪ new synonym names — alias/disambiguation pages. */
			synonymNames?: string[];
			/** Perakim whose curated refs link the entry (pre-resolved on delete). */
			refPerekIds?: number[];
	  }
	| {
			kind: "pedia-entity";
			/** tanahpedia_entity.id — person/place/saying/… rows share it. */
			entityId: string;
			/** Entity type when known — category-page dep on delete. */
			entityType?: string;
			/** Pre-resolved linked entry unique_names (deletes/unlinks). */
			entryUniqueNames?: string[];
			/** Pre-resolved perakim sourcing the entity (deletes/unlinks). */
			refPerekIds?: number[];
	  }
	| {
			kind: "pedia-entries";
			/** Entry unique_names the caller resolved before commit. */
			uniqueNames: string[];
			entityTypes?: string[];
			refPerekIds?: number[];
	  }
	| {
			kind: "moed";
			/** tanah_moed.id — survives edits/deletes. */
			id: number;
			/** Current canonical slug (the deleted slug on deletes). */
			slug: string;
			/** The pre-rename slug — expires the stale detail route/tag. */
			oldSlug?: string;
	  }
	| {
			kind: "dedication";
			/** tanah_dedication.id — survives edits/deletes. */
			id: number;
			/**
			 * Old ∪ new assignments of the dedication (#2731). The admin
			 * resolves them post-commit from the link tables (pre-commit on
			 * delete), and the website maps them to the scoped cache tags
			 * and pages that render them.
			 */
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
