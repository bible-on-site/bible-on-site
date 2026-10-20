import { query } from "../db";
import {
	pediaEntryPath,
	pediaInvalidation,
	type RevalidateRequest,
} from "../website-revalidate";

/**
 * Maps tanahpedia rows to the public entry pages (`/pedia/<unique_name>`)
 * their edits affect, so the revalidation call can name the exact URLs that
 * changed for the IndexNow notification. Resolve the ids *before* a delete:
 * once the row (and its cascading entry_entity links) is gone, the affected
 * pages can no longer be enumerated.
 */

function placeholders(count: number): string {
	return Array.from({ length: count }, () => "?").join(", ");
}

/** Entry paths of the given entry ids. */
export async function pediaPathsForEntryIds(
	entryIds: string[],
): Promise<string[]> {
	if (entryIds.length === 0) return [];
	const rows = await query<{ unique_name: string }>(
		`SELECT unique_name FROM tanahpedia_entry
		 WHERE id IN (${placeholders(entryIds.length)})`,
		entryIds,
	);
	return rows.map((row) => pediaEntryPath(row.unique_name));
}

/**
 * Entry paths of every entry linked to any of the given entities — the pages
 * whose rendered content an entity-level edit (name, sex, dates, family
 * data) can change.
 */
export async function pediaPathsForEntities(
	entityIds: string[],
): Promise<string[]> {
	if (entityIds.length === 0) return [];
	const rows = await query<{ unique_name: string }>(
		`SELECT DISTINCT e.unique_name FROM tanahpedia_entry e
		 JOIN tanahpedia_entry_entity ee ON ee.entry_id = e.id
		 WHERE ee.entity_id IN (${placeholders(entityIds.length)})`,
		entityIds,
	);
	return rows.map((row) => pediaEntryPath(row.unique_name));
}

/** Entry paths of every entry linked to the given persons' entities. */
export async function pediaPathsForPersons(
	personIds: string[],
): Promise<string[]> {
	if (personIds.length === 0) return [];
	const rows = await query<{ entity_id: string }>(
		`SELECT entity_id FROM tanahpedia_person
		 WHERE id IN (${placeholders(personIds.length)}) AND entity_id IS NOT NULL`,
		personIds,
	);
	return pediaPathsForEntities(rows.map((row) => row.entity_id));
}

/** Invalidation batch covering every entry linked to the given entities. */
export async function pediaInvalidationForEntities(
	entityIds: string[],
): Promise<RevalidateRequest[]> {
	return pediaInvalidation(...(await pediaPathsForEntities(entityIds)));
}

/** Invalidation batch covering every entry linked to the given persons. */
export async function pediaInvalidationForPersons(
	personIds: string[],
): Promise<RevalidateRequest[]> {
	return pediaInvalidation(...(await pediaPathsForPersons(personIds)));
}

/** Invalidation batch for the given entry ids. */
export async function pediaInvalidationForEntryIds(
	entryIds: string[],
): Promise<RevalidateRequest[]> {
	return pediaInvalidation(...(await pediaPathsForEntryIds(entryIds)));
}
