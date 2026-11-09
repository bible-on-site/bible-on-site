import { query } from "../db";
import type { EntityChange, RevalidateRequest } from "../website-revalidate";

/**
 * Maps tanahpedia rows to typed entity-change events for the website's
 * revalidation endpoint. The helpers resolve the *destroyed* side of a
 * relationship while it still exists — resolve the ids/names *before* a
 * delete: once the row (and its cascading entry_entity links) is gone, the
 * affected entries and source perakim can no longer be enumerated. The
 * website unions these with the relationships it can still resolve.
 */

function placeholders(count: number): string {
	return Array.from({ length: count }, () => "?").join(", ");
}

interface EntryRelations {
	uniqueName: string;
	entityTypes: string[];
	synonymNames: string[];
	refPerekIds: number[];
}

/** Batched relations for every entry id, keyed by entry id. */
async function entriesRelations(
	entryIds: string[],
): Promise<Map<string, EntryRelations>> {
	const inList = placeholders(entryIds.length);
	const [entries, entityTypeRows, synonymRows, perekRows] = await Promise.all([
		query<{ id: string; unique_name: string }>(
			`SELECT id, unique_name FROM tanahpedia_entry WHERE id IN (${inList})`,
			entryIds,
		),
		query<{ entry_id: string; entity_type: string }>(
			`SELECT DISTINCT ee.entry_id, e.entity_type FROM tanahpedia_entry_entity ee
			 JOIN tanahpedia_entity e ON e.id = ee.entity_id
			 WHERE ee.entry_id IN (${inList})`,
			entryIds,
		),
		// Synonym names each entry renders under: direct aliases plus the
		// disambiguation pages listing it as a target — deleting the entry
		// cascades both link kinds, so those pages expire too.
		query<{ entry_id: string; name: string }>(
			`SELECT entry_id, name FROM tanahpedia_entry_synonym WHERE entry_id IN (${inList})
			 UNION
			 SELECT d.entry_id, s2.name FROM tanahpedia_entry_synonym_disambiguation d
			 JOIN tanahpedia_entry_synonym s2 ON s2.id = d.synonym_id
			 WHERE d.entry_id IN (${inList})`,
			[...entryIds, ...entryIds],
		),
		query<{ entry_id: string; perek_id: number }>(
			`SELECT DISTINCT ee.entry_id, ets.perek_id FROM tanahpedia_entity_tanah_source ets
			 JOIN tanahpedia_entry_entity ee ON ee.entity_id = ets.entity_id
			 WHERE ee.entry_id IN (${inList})`,
			entryIds,
		),
	]);
	const relations = new Map<string, EntryRelations>(
		entries.map((e) => [
			e.id,
			{
				uniqueName: e.unique_name,
				entityTypes: [],
				synonymNames: [],
				refPerekIds: [],
			},
		]),
	);
	for (const row of entityTypeRows) {
		relations.get(row.entry_id)?.entityTypes.push(row.entity_type);
	}
	for (const row of synonymRows) {
		relations.get(row.entry_id)?.synonymNames.push(row.name);
	}
	for (const row of perekRows) {
		relations.get(row.entry_id)?.refPerekIds.push(row.perek_id);
	}
	return relations;
}

/**
 * One `pedia-entry` change per entry id, carrying the entry's current
 * relationships — the dependency set a delete/unlink can no longer be
 * resolved from afterwards.
 */
export async function pediaChangesForEntryIds(
	entryIds: string[],
): Promise<RevalidateRequest[]> {
	if (entryIds.length === 0) return [];
	const relations = await entriesRelations(entryIds);
	const changes: EntityChange[] = [];
	for (const entryId of entryIds) {
		const rel = relations.get(entryId);
		if (!rel) continue;
		changes.push({
			kind: "pedia-entry",
			uniqueName: rel.uniqueName,
			entityTypes: rel.entityTypes,
			synonymNames: rel.synonymNames,
			refPerekIds: rel.refPerekIds,
		});
	}
	return changes.length ? [{ changes }] : [];
}

/**
 * One `pedia-entity` change per entity — the entity's type, the entries
 * linked to it and the perakim whose curated references source it.
 */
export async function pediaChangesForEntities(
	entityIds: string[],
): Promise<RevalidateRequest[]> {
	if (entityIds.length === 0) return [];
	const [types, linkedEntries, refPereks] = await Promise.all([
		query<{ id: string; entity_type: string }>(
			`SELECT id, entity_type FROM tanahpedia_entity
			 WHERE id IN (${placeholders(entityIds.length)})`,
			entityIds,
		),
		query<{ entity_id: string; unique_name: string }>(
			`SELECT DISTINCT ee.entity_id, e.unique_name FROM tanahpedia_entry e
			 JOIN tanahpedia_entry_entity ee ON ee.entry_id = e.id
			 WHERE ee.entity_id IN (${placeholders(entityIds.length)})`,
			entityIds,
		),
		query<{ entity_id: string; perek_id: number }>(
			`SELECT DISTINCT entity_id, perek_id FROM tanahpedia_entity_tanah_source
			 WHERE entity_id IN (${placeholders(entityIds.length)})`,
			entityIds,
		),
	]);
	const changes: EntityChange[] = entityIds.map((entityId) => ({
		kind: "pedia-entity",
		entityId,
		...(types.find((t) => t.id === entityId)?.entity_type
			? { entityType: types.find((t) => t.id === entityId)?.entity_type }
			: {}),
		entryUniqueNames: [
			...new Set(
				linkedEntries
					.filter((r) => r.entity_id === entityId)
					.map((r) => r.unique_name),
			),
		],
		refPerekIds: [
			...new Set(
				refPereks
					.filter((r) => r.entity_id === entityId)
					.map((r) => r.perek_id),
			),
		],
	}));
	return changes.length ? [{ changes }] : [];
}

/** Entity changes for every person id's linked entity. */
export async function pediaChangesForPersons(
	personIds: string[],
): Promise<RevalidateRequest[]> {
	if (personIds.length === 0) return [];
	const rows = await query<{ entity_id: string }>(
		`SELECT entity_id FROM tanahpedia_person
		 WHERE id IN (${placeholders(personIds.length)}) AND entity_id IS NOT NULL`,
		personIds,
	);
	return pediaChangesForEntities(rows.map((row) => row.entity_id));
}
