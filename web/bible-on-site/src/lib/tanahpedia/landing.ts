import { unstable_cache } from "next/cache";
import { cachedPerKey, COLLECTION_TAGS } from "@/lib/revalidate/tags";
import {
	getCategoryCounts,
	getRecentEntries,
	getTodayInTanahEntities,
} from "./service";

/**
 * `/pedia` stays force-dynamic (the Hebrew date is computed per request),
 * but its three reads are identical for every visitor: cache them and let
 * admin entity changes expire them via COLLECTION_TAGS.pedia. The
 * anniversary lookup keys on the Hebrew month-day, so each day gets its
 * own entry and recomputes once.
 */
export const getCachedCategoryCounts = unstable_cache(
	getCategoryCounts,
	["tanahpedia-category-counts"],
	{ tags: [COLLECTION_TAGS.pedia], revalidate: false },
);

export const getCachedRecentEntries = cachedPerKey(
	"tanahpedia-recent-entries",
	(limit: number) => String(limit),
	() => [COLLECTION_TAGS.pedia],
	(limit: number) => getRecentEntries(limit),
);

export const getCachedTodayInTanahEntities = cachedPerKey(
	"tanahpedia-today",
	(hebrewMonth: number, hebrewDay: number) => `${hebrewMonth}-${hebrewDay}`,
	() => [COLLECTION_TAGS.pedia],
	(hebrewMonth: number, hebrewDay: number) =>
		getTodayInTanahEntities(hebrewMonth, hebrewDay),
);
