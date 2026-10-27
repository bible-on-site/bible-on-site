import {
	cachedPerKey,
	COLLECTION_TAGS,
	entityRefsTag,
	mentionRefsTag,
} from "@/lib/revalidate/tags";
import {
	getEntityReferencesForPerek,
	getMentionReferencesForPerek,
	type PerekEntityReference,
} from "./service";
import { isMissingMysqlSchema } from "@/lib/mysql-errors";

const getCachedEntityRefs = cachedPerKey(
	"tanahpedia-entity-refs",
	(perekId: number) => String(perekId),
	(key) => [
		COLLECTION_TAGS.pediaEntityRefs,
		entityRefsTag(Number(key)),
	],
	(perekId: number) => getEntityReferencesForPerek(perekId),
);

// Mention decorations (#2516) resolve against live entries at presentation
// time — the cache expires on entry lifecycle events via the broad
// `tanahpedia-mention-refs` tag (name-keyed resolution has no per-perek
// scope) and the per-perek `perek:{id}:mention-refs` tag.
const getCachedMentionRefs = cachedPerKey(
	"tanahpedia-mention-refs",
	(perekId: number) => String(perekId),
	(key) => [
		COLLECTION_TAGS.pediaMentionRefs,
		mentionRefsTag(Number(key)),
	],
	(perekId: number) => getMentionReferencesForPerek(perekId),
);

/**
 * The decoration families degrade only while their schema is absent (the
 * #2516 upgrade window): every other failure rejects inside the cache, so
 * nothing stale is stored — the next request retries instead of serving a
 * permanently cached empty decoration set.
 */
async function refsOrEmpty(
	cached: (perekId: number) => Promise<PerekEntityReference[]>,
	perekId: number,
): Promise<PerekEntityReference[]> {
	try {
		return await cached(perekId);
	} catch (error) {
		if (isMissingMysqlSchema(error)) return [];
		throw error;
	}
}

/** References for the visible perek and the other pages in its book view. */
export async function fetchAllEntityRefs(
	perekIds: number[],
): Promise<Record<number, PerekEntityReference[]>> {
	const [allRefs, allMentions] = await Promise.all([
		Promise.all(perekIds.map((id) => refsOrEmpty(getCachedEntityRefs, id))),
		Promise.all(perekIds.map((id) => refsOrEmpty(getCachedMentionRefs, id))),
	]);
	const result: Record<number, PerekEntityReference[]> = {};
	for (let i = 0; i < perekIds.length; i++) {
		// Curated entity refs come first — getSegmentRuns resolves the first
		// ref covering a segment, so human-curated links win over decorations.
		const combined = [...allRefs[i], ...allMentions[i]];
		if (combined.length > 0) {
			result[perekIds[i]] = combined;
		}
	}
	return result;
}
