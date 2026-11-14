import { unstable_cache } from "next/cache";
import { COLLECTION_TAGS } from "../revalidate/tags";
import { getPublishedMoadim, MOED_STALE_BOUND_SECONDS } from "./service";

// Hourly bound keeps a pre-migration empty catalogue from pinning — the
// data-deploy seed lands without a website invalidation, so the catalogue
// self-heals on the next ISR window (editorial writes still expire via tag).
/** The published catalogue, shared by the wheel, the breadcrumb sibling
 * pickers and every other read of the annual set (#3101, #3266). */
export const getCachedMoadim = unstable_cache(
	getPublishedMoadim,
	["moadim-catalogue"],
	{
		tags: [COLLECTION_TAGS.moadim],
		revalidate: MOED_STALE_BOUND_SECONDS,
	},
);
