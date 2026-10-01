import { unstable_cache } from "next/cache";
import {
	getEntityReferencesForPerek,
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

/** References for the visible perek and the other pages in its book view. */
export async function fetchAllEntityRefs(
	perekIds: number[],
): Promise<Record<number, PerekEntityReference[]>> {
	const allRefs = await Promise.all(
		perekIds.map((id) => getCachedEntityRefs(id)),
	);
	const result: Record<number, PerekEntityReference[]> = {};
	for (let i = 0; i < perekIds.length; i++) {
		if (allRefs[i].length > 0) {
			result[perekIds[i]] = allRefs[i];
		}
	}
	return result;
}
