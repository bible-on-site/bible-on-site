/**
 * Cached Tanahpedia loaders shared by the website routes. Every loader
 * goes through `unstable_cache` with collection tags so `/api/revalidate`
 * can expire exactly what a committed content change touched. Loaders
 * consumed only by dynamic routes (/pedia) carry a 1h TTL as a backstop
 * for writes that bypass the change channel; loaders consumed by fully
 * static entry pages are event-driven only (see cachedPerKey).
 */
import { unstable_cache } from "next/cache";
import {
	COLLECTION_TAGS,
	cachedPerKey,
	pediaCategoryTag,
} from "@/lib/revalidate/tags";
import type { EntityType } from "./types";
import {
	getCategoryCounts,
	getEntryByUniqueName,
	getEntityTypeEntrySummaries,
	getRecentEntrySummaries,
	getTodayInTanahEntities,
} from "./service";

const landingTags = [COLLECTION_TAGS.pediaLanding, COLLECTION_TAGS.pediaEntries];

/** Category counts shown on /pedia and each category header. */
export const getCachedCategoryCounts = unstable_cache(
	() => getCategoryCounts(),
	["tanahpedia-category-counts"],
	{ tags: landingTags, revalidate: 3600 },
);

/** Recent entries shown on /pedia (summaries only — no body). */
export const getCachedRecentEntrySummaries = unstable_cache(
	(limit: number) => getRecentEntrySummaries(limit),
	["tanahpedia-recent-entries"],
	{ tags: landingTags, revalidate: 3600 },
);

/**
 * "היום בתנ"ך" anniversaries — cached per Hebrew month-day so each date
 * computes once a day instead of per request; entry/entity changes still
 * expire it through the collection tags.
 */
export const getCachedTodayInTanahEntities = cachedPerKey(
	"tanahpedia-today-entities",
	(hebrewMonth: number, hebrewDay: number) => `${hebrewMonth}-${hebrewDay}`,
	() => landingTags,
	(hebrewMonth: number, hebrewDay: number) =>
		getTodayInTanahEntities(hebrewMonth, hebrewDay),
	3600,
);

/**
 * Entries of one entity type for the entry-page sibling dropdown —
 * summaries only. The entry page is fully static, so expiry is
 * event-driven only (no time bound — see cachedPerKey).
 */
export const getCachedEntityTypeEntrySummaries = cachedPerKey(
	"tanahpedia-entity-type-entry-summaries",
	(entityType: EntityType) => entityType,
	(key) => [COLLECTION_TAGS.pediaEntries, pediaCategoryTag(key)],
	(entityType) => getEntityTypeEntrySummaries(entityType),
);

export { getEntryByUniqueName };
