import { query } from "../api-client";
import type {
	CategoryHomepage,
	EntityType,
	EntityWithEntries,
	Entry,
	EntryEntity,
	EntryStub,
	EntryWithEntities,
	PlaceIdentification,
	ThreeDModel,
} from "./types";

const ENTITY_TABLE_MAP: Record<EntityType, string> = {
	PERSON: "tanahpedia_person",
	PLACE: "tanahpedia_place",
	EVENT: "tanahpedia_event",
	WAR: "tanahpedia_war",
	ANIMAL: "tanahpedia_animal",
	OBJECT: "tanahpedia_object",
	TEMPLE_TOOL: "tanahpedia_temple_tool",
	PLANT: "tanahpedia_plant",
	ASTRONOMICAL_OBJECT: "tanahpedia_astronomical_object",
	SAYING: "tanahpedia_saying",
	SEFER: "tanahpedia_sefer",
	PROPHECY: "tanahpedia_prophecy",
	NATION: "tanahpedia_nation",
};

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
	PERSON: "אישים",
	PLACE: "מקומות",
	EVENT: "אירועים",
	WAR: "מלחמות",
	ANIMAL: "בעלי חיים",
	OBJECT: "חפצים",
	TEMPLE_TOOL: "כלי מקדש",
	PLANT: "צמחים",
	ASTRONOMICAL_OBJECT: "גרמי שמיים",
	SAYING: "אמרות",
	SEFER: "ספרים",
	PROPHECY: "נבואות",
	NATION: "עמים",
};

export const ENTITY_TYPES = Object.keys(ENTITY_TABLE_MAP) as EntityType[];

function getNameColumn(entityType: EntityType): string {
	if (entityType === "PERSON") return "pn.name";
	if (entityType === "TEMPLE_TOOL") return "tt.name";
	return "e.name";
}

function getNameJoin(entityType: EntityType): string {
	const table = ENTITY_TABLE_MAP[entityType];
	if (entityType === "PERSON") {
		return `${table} e
      JOIN tanahpedia_person_name pn ON pn.person_id = e.id
        AND pn.name_type_id = (SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1)`;
	}
	if (entityType === "TEMPLE_TOOL") {
		return `${table} tt
      JOIN tanahpedia_object e ON e.id = tt.object_id`;
	}
	return `${table} e`;
}

export async function getEntries(limit = 50, offset = 0): Promise<Entry[]> {
	return query<Entry>(
		"SELECT id, unique_name AS uniqueName, title, content, created_at AS createdAt, updated_at AS updatedAt FROM tanahpedia_entry ORDER BY title LIMIT ? OFFSET ?",
		[limit, offset],
	);
}

export async function getEntryByUniqueName(
	uniqueName: string,
): Promise<EntryWithEntities | null> {
	const entries = await query<Entry>(
		"SELECT id, unique_name AS uniqueName, title, content, created_at AS createdAt, updated_at AS updatedAt FROM tanahpedia_entry WHERE unique_name = ?",
		[uniqueName],
	);
	if (entries.length === 0) return null;

	const entry = entries[0];
	const entities = await query<EntryEntity>(
		"SELECT id, entry_id AS entryId, entity_type AS entityType, entity_id AS entityId FROM tanahpedia_entry_entity WHERE entry_id = ?",
		[entry.id],
	);

	return { ...entry, entities };
}

export async function getEntriesByEntityType(
	entityType: EntityType,
): Promise<Entry[]> {
	return query<Entry>(
		`SELECT DISTINCT e.id, e.unique_name AS uniqueName, e.title, e.content, e.created_at AS createdAt, e.updated_at AS updatedAt
     FROM tanahpedia_entry e
     JOIN tanahpedia_entry_entity ee ON ee.entry_id = e.id
     WHERE ee.entity_type = ?
     ORDER BY e.title`,
		[entityType],
	);
}

export async function getEntitiesWithEntries(
	entityType: EntityType,
): Promise<EntityWithEntries[]> {
	const nameCol = getNameColumn(entityType);
	const fromJoin = getNameJoin(entityType);

	const rows = await query<{
		entityId: string;
		entityName: string;
		entryId: string | null;
		entryUniqueName: string | null;
		entryTitle: string | null;
	}>(
		`SELECT e.id AS entityId, ${nameCol} AS entityName,
            ent.id AS entryId, ent.unique_name AS entryUniqueName, ent.title AS entryTitle
     FROM ${fromJoin}
     LEFT JOIN tanahpedia_entry_entity ee ON ee.entity_id = e.id AND ee.entity_type = ?
     LEFT JOIN tanahpedia_entry ent ON ent.id = ee.entry_id
     ORDER BY ${nameCol}`,
		[entityType],
	);

	const grouped = new Map<
		string,
		{ entityName: string; linkedEntries: EntryStub[] }
	>();

	for (const row of rows) {
		let group = grouped.get(row.entityId);
		if (!group) {
			group = { entityName: row.entityName, linkedEntries: [] };
			grouped.set(row.entityId, group);
		}
		if (row.entryId && row.entryUniqueName && row.entryTitle) {
			group.linkedEntries.push({
				id: row.entryId,
				uniqueName: row.entryUniqueName,
				title: row.entryTitle,
			});
		}
	}

	return Array.from(grouped.entries()).map(([entityId, data]) => ({
		entityType,
		entityId,
		entityName: data.entityName,
		linkedEntries: data.linkedEntries,
	}));
}

export async function getCategoryHomepage(
	entityType: EntityType,
): Promise<CategoryHomepage | null> {
	const rows = await query<CategoryHomepage>(
		`SELECT id, entity_type AS entityType, layout_type AS layoutType,
            config, content, updated_at AS updatedAt
     FROM tanahpedia_category_homepage
     WHERE entity_type = ?`,
		[entityType],
	);
	if (rows.length === 0) return null;
	const row = rows[0];
	return {
		...row,
		config:
			typeof row.config === "string" ? JSON.parse(row.config) : row.config,
	};
}

export async function get3DModels(
	entityType: string,
	entityId: string,
): Promise<ThreeDModel[]> {
	return query<ThreeDModel>(
		`SELECT id, entity_type AS entityType, entity_id AS entityId,
            blob_key AS blobKey, format, label, alt_group_id AS altGroupId
     FROM tanahpedia_3d_model
     WHERE entity_type = ? AND entity_id = ?`,
		[entityType, entityId],
	);
}

export async function getPlaceIdentifications(): Promise<
	(PlaceIdentification & { placeName: string })[]
> {
	return query(
		`SELECT pi.id, pi.place_id AS placeId, pi.modern_name AS modernName,
            pi.latitude, pi.longitude, pi.alt_group_id AS altGroupId,
            p.name AS placeName
     FROM tanahpedia_place_identification pi
     JOIN tanahpedia_place p ON p.id = pi.place_id
     WHERE pi.latitude IS NOT NULL AND pi.longitude IS NOT NULL`,
	);
}

export async function getEntityTypeCounts(): Promise<
	Record<EntityType, number>
> {
	const rows = await query<{ entityType: EntityType; cnt: number }>(
		`SELECT entity_type AS entityType, COUNT(*) AS cnt
     FROM tanahpedia_entry_entity
     GROUP BY entity_type`,
	);
	const counts = {} as Record<EntityType, number>;
	for (const et of ENTITY_TYPES) counts[et] = 0;
	for (const row of rows) counts[row.entityType] = Number(row.cnt);
	return counts;
}

export async function getRecentEntries(limit = 10): Promise<Entry[]> {
	return query<Entry>(
		"SELECT id, unique_name AS uniqueName, title, content, created_at AS createdAt, updated_at AS updatedAt FROM tanahpedia_entry ORDER BY updated_at DESC LIMIT ?",
		[limit],
	);
}
