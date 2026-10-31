import { isMissingMysqlSchema } from "@/lib/mysql-errors";
import {
	COLLECTION_TAGS,
	cachedPerKey,
	entityRefsTag,
	mentionRefsTag,
} from "@/lib/revalidate/tags";
import {
	getEntityReferencesForPereks,
	getMentionReferencesForPereks,
	type PerekEntityReference,
	type PerekScopedEntityReference,
} from "./service";

// Each entry retains its collection tag and every requested chapter tag,
// comfortably below Next's 128-tag limit without widening its query scope.
const REFERENCE_BATCH_SIZE = 64;
const keyOf = (ids: number[]) => ids.join(",");

const getCachedEntityRefs = cachedPerKey(
	"tanahpedia-entity-refs-batch",
	keyOf,
	(key) => [
		COLLECTION_TAGS.pediaEntityRefs,
		...key.split(",").map((id) => entityRefsTag(Number(id))),
	],
	(ids: number[]) => getEntityReferencesForPereks(ids),
);

// Live name resolution keeps the existing collection-level invalidation;
// every chapter in this exact batch also keeps its scoped mention tag.
const getCachedMentionRefs = cachedPerKey(
	"tanahpedia-mention-refs-batch",
	keyOf,
	(key) => [
		COLLECTION_TAGS.pediaMentionRefs,
		...key.split(",").map((id) => mentionRefsTag(Number(id))),
	],
	(ids: number[]) => getMentionReferencesForPereks(ids),
);

/** Missing schemas degrade outside the cache so recovery always retries. */
async function refsOrEmpty(
	cached: (ids: number[]) => Promise<PerekScopedEntityReference[]>,
	ids: number[],
): Promise<PerekScopedEntityReference[]> {
	try {
		return await cached(ids);
	} catch (error) {
		if (isMissingMysqlSchema(error)) return [];
		throw error;
	}
}

/** References for the visible perek and the other pages in its book view. */
export async function fetchAllEntityRefs(
	perekIds: number[],
): Promise<Record<number, PerekEntityReference[]>> {
	// Canonicalize both the cache definition and its invocation arguments:
	// unstable_cache includes JSON.stringify(args) in the stored cache key.
	const ids = [...new Set(perekIds)].sort((a, b) => a - b);
	const requested = new Set(ids);
	const batches: number[][] = [];
	for (let i = 0; i < ids.length; i += REFERENCE_BATCH_SIZE) {
		batches.push(ids.slice(i, i + REFERENCE_BATCH_SIZE));
	}
	const rows = await Promise.all(
		batches.map(async (batch) => {
			const [curated, mentions] = await Promise.all([
				refsOrEmpty(getCachedEntityRefs, batch),
				refsOrEmpty(getCachedMentionRefs, batch),
			]);
			// Curated refs win overlapping segments. Preserve the service's
			// order within each family, including manual-mention precedence.
			return [...curated, ...mentions];
		}),
	);
	const result: Record<number, PerekEntityReference[]> = {};
	for (const batch of rows) {
		for (const row of batch) {
			if (!requested.has(row.perekId)) continue;
			const refs = result[row.perekId] ?? [];
			refs.push({
				entityId: row.entityId,
				entityName: row.entityName,
				entityType: row.entityType,
				entryUniqueName: row.entryUniqueName,
				pasukNumber: row.pasukNumber,
				segmentStart: row.segmentStart,
				segmentEnd: row.segmentEnd,
			});
			result[row.perekId] = refs;
		}
	}
	return result;
}
