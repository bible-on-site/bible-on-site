import { unstable_cache } from "next/cache";
import {
	getEntityReferencesForPerek,
	getMentionReferencesForPerek,
	type PerekEntityReference,
} from "./service";

const getCachedEntityRefs = unstable_cache(
	async (perekId: number) => getEntityReferencesForPerek(perekId),
	["tanahpedia-entity-refs"],
	{
		tags: ["tanahpedia-entity-refs"],
		revalidate: false,
	},
);

// Mention decorations (#2516) resolve against live entries at presentation
// time — the cache expires on entry lifecycle events via the
// `tanahpedia-mention-refs` tag the admin pediaInvalidation emits.
const getCachedMentionRefs = unstable_cache(
	async (perekId: number) => getMentionReferencesForPerek(perekId),
	["tanahpedia-mention-refs"],
	{
		tags: ["tanahpedia-mention-refs"],
		revalidate: false,
	},
);

/** References for the visible perek and the other pages in its book view. */
export async function fetchAllEntityRefs(
	perekIds: number[],
): Promise<Record<number, PerekEntityReference[]>> {
	const [allRefs, allMentions] = await Promise.all([
		Promise.all(perekIds.map((id) => getCachedEntityRefs(id))),
		Promise.all(perekIds.map((id) => getCachedMentionRefs(id))),
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
