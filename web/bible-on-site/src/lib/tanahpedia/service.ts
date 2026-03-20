import { query } from "../api-client";
import type {
	CategoryHomepage,
	CategoryKey,
	EntityType,
	EntityWithEntries,
	Entry,
	EntryStub,
	EntryWithEntities,
	PlaceIdentification,
	ThreeDModel,
} from "./types";

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
	TANAH_SEFER: 'ספרי תנ"ך',
	PROPHECY: "נבואות",
	NATION: "עמים",
};

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
	...ENTITY_TYPE_LABELS,
	PROPHET: "נביאים",
	KING: "מלכים",
	BEHEMA: "בהמות",
	CHAYA: "חיות",
	OF: "עופות",
	SHERETZ: "שרצים",
	TAHOR: "טהורים",
	TAMEH: "טמאים",
};

export const ENTITY_TYPES = Object.keys(ENTITY_TYPE_LABELS) as EntityType[];

export async function getEntries(limit = 50, offset = 0): Promise<Entry[]> {
	return query<Entry>(
		"SELECT id, unique_name AS uniqueName, title, content, created_at AS createdAt, updated_at AS updatedAt FROM tanahpedia_entry ORDER BY title LIMIT ? OFFSET ?",
		[String(limit), String(offset)],
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
	const entities = await query<{
		id: string;
		entryId: string;
		entityId: string;
		entityType: EntityType;
		entityName: string;
	}>(
		`SELECT ee.id, ee.entry_id AS entryId, ee.entity_id AS entityId,
		        e.entity_type AS entityType, e.name AS entityName
		 FROM tanahpedia_entry_entity ee
		 JOIN tanahpedia_entity e ON e.id = ee.entity_id
		 WHERE ee.entry_id = ?`,
		[entry.id],
	);

	return { ...entry, entities };
}

export async function getEntriesByEntityType(
	entityType: EntityType,
): Promise<Entry[]> {
	return query<Entry>(
		`SELECT DISTINCT ent.id, ent.unique_name AS uniqueName, ent.title, ent.content, ent.created_at AS createdAt, ent.updated_at AS updatedAt
     FROM tanahpedia_entry ent
     JOIN tanahpedia_entry_entity ee ON ee.entry_id = ent.id
     JOIN tanahpedia_entity e ON e.id = ee.entity_id
     WHERE e.entity_type = ?
     ORDER BY ent.title`,
		[entityType],
	);
}

export async function getEntitiesWithEntries(
	entityType: EntityType,
): Promise<EntityWithEntries[]> {
	const rows = await query<{
		entityId: string;
		entityName: string;
		entryId: string | null;
		entryUniqueName: string | null;
		entryTitle: string | null;
	}>(
		`SELECT e.id AS entityId, e.name AS entityName,
		        ent.id AS entryId, ent.unique_name AS entryUniqueName, ent.title AS entryTitle
		 FROM tanahpedia_entity e
		 LEFT JOIN tanahpedia_entry_entity ee ON ee.entity_id = e.id
		 LEFT JOIN tanahpedia_entry ent ON ent.id = ee.entry_id
		 WHERE e.entity_type = ?
		 ORDER BY e.name`,
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

export async function getEntitiesWithEntriesByRole(
	role: "PROPHET" | "KING",
): Promise<EntityWithEntries[]> {
	const roleTable =
		role === "PROPHET"
			? "tanahpedia_person_role_prophet"
			: "tanahpedia_person_role_king";
	const rows = await query<{
		entityId: string;
		entityName: string;
		entryId: string | null;
		entryUniqueName: string | null;
		entryTitle: string | null;
	}>(
		`SELECT e.id AS entityId, e.name AS entityName,
		        ent.id AS entryId, ent.unique_name AS entryUniqueName, ent.title AS entryTitle
		 FROM ${roleTable} r
		 JOIN tanahpedia_person p ON p.id = r.person_id
		 JOIN tanahpedia_entity e ON e.id = p.entity_id
		 LEFT JOIN tanahpedia_entry_entity ee ON ee.entity_id = e.id
		 LEFT JOIN tanahpedia_entry ent ON ent.id = ee.entry_id
		 ORDER BY e.name`,
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
		entityType: "PERSON" as EntityType,
		entityId,
		entityName: data.entityName,
		linkedEntries: data.linkedEntries,
	}));
}

export async function getAnimalsByClassification(
	classType: "kind" | "purity",
	value: string,
): Promise<EntityWithEntries[]> {
	const table =
		classType === "kind"
			? "tanahpedia_animal_kind"
			: "tanahpedia_animal_purity";
	const column = classType === "kind" ? "kind" : "purity";
	const rows = await query<{
		entityId: string;
		entityName: string;
		entryId: string | null;
		entryUniqueName: string | null;
		entryTitle: string | null;
	}>(
		`SELECT e.id AS entityId, e.name AS entityName,
		        ent.id AS entryId, ent.unique_name AS entryUniqueName, ent.title AS entryTitle
		 FROM ${table} ac
		 JOIN tanahpedia_animal a ON a.id = ac.animal_id
		 JOIN tanahpedia_entity e ON e.id = a.entity_id
		 LEFT JOIN tanahpedia_entry_entity ee ON ee.entity_id = e.id
		 LEFT JOIN tanahpedia_entry ent ON ent.id = ee.entry_id
		 WHERE ac.${column} = ?
		 ORDER BY e.name`,
		[value],
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
		entityType: "ANIMAL" as EntityType,
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

export async function get3DModels(entityId: string): Promise<ThreeDModel[]> {
	return query<ThreeDModel>(
		`SELECT id, entity_id AS entityId,
		        blob_key AS blobKey, format, label, alt_group_id AS altGroupId
		 FROM tanahpedia_3d_model
		 WHERE entity_id = ?`,
		[entityId],
	);
}

export async function getPlaceIdentifications(): Promise<
	(PlaceIdentification & { placeName: string })[]
> {
	return query(
		`SELECT pi.id, pi.place_id AS placeId, pi.modern_name AS modernName,
		        pi.latitude, pi.longitude, pi.alt_group_id AS altGroupId,
		        e.name AS placeName
		 FROM tanahpedia_place_identification pi
		 JOIN tanahpedia_place p ON p.id = pi.place_id
		 JOIN tanahpedia_entity e ON e.id = p.entity_id
		 WHERE pi.latitude IS NOT NULL AND pi.longitude IS NOT NULL`,
	);
}

export async function getCategoryCounts(): Promise<
	Record<CategoryKey, number>
> {
	const [entityRows, roleRows, animalRows] = await Promise.all([
		query<{ entityType: EntityType; cnt: number }>(
			`SELECT e.entity_type AS entityType, COUNT(DISTINCT ee.entry_id) AS cnt
			 FROM tanahpedia_entry_entity ee
			 JOIN tanahpedia_entity e ON e.id = ee.entity_id
			 GROUP BY e.entity_type`,
		),
		query<{ role: string; cnt: number }>(
			`SELECT 'PROPHET' AS role, COUNT(DISTINCT ee.entry_id) AS cnt
			 FROM tanahpedia_person_role_prophet pr
			 JOIN tanahpedia_person p ON p.id = pr.person_id
			 JOIN tanahpedia_entry_entity ee ON ee.entity_id = p.entity_id
			 UNION ALL
			 SELECT 'KING' AS role, COUNT(DISTINCT ee.entry_id) AS cnt
			 FROM tanahpedia_person_role_king pk
			 JOIN tanahpedia_person p ON p.id = pk.person_id
			 JOIN tanahpedia_entry_entity ee ON ee.entity_id = p.entity_id`,
		),
		query<{ cat: string; cnt: number }>(
			`SELECT ak.kind AS cat, COUNT(DISTINCT ee.entry_id) AS cnt
			 FROM tanahpedia_animal_kind ak
			 JOIN tanahpedia_animal a ON a.id = ak.animal_id
			 JOIN tanahpedia_entry_entity ee ON ee.entity_id = a.entity_id
			 GROUP BY ak.kind
			 UNION ALL
			 SELECT ap.purity AS cat, COUNT(DISTINCT ee.entry_id) AS cnt
			 FROM tanahpedia_animal_purity ap
			 JOIN tanahpedia_animal a ON a.id = ap.animal_id
			 JOIN tanahpedia_entry_entity ee ON ee.entity_id = a.entity_id
			 GROUP BY ap.purity`,
		),
	]);
	const counts = {} as Record<CategoryKey, number>;
	for (const et of ENTITY_TYPES) counts[et] = 0;
	counts.PROPHET = 0;
	counts.KING = 0;
	counts.BEHEMA = 0;
	counts.CHAYA = 0;
	counts.OF = 0;
	counts.SHERETZ = 0;
	counts.TAHOR = 0;
	counts.TAMEH = 0;
	for (const row of entityRows) counts[row.entityType] = Number(row.cnt);
	for (const row of roleRows)
		counts[row.role as CategoryKey] = Number(row.cnt);
	for (const row of animalRows)
		counts[row.cat as CategoryKey] = Number(row.cnt);
	return counts;
}

export async function getRecentEntries(limit = 10): Promise<Entry[]> {
	return query<Entry>(
		"SELECT id, unique_name AS uniqueName, title, content, created_at AS createdAt, updated_at AS updatedAt FROM tanahpedia_entry ORDER BY updated_at DESC LIMIT ?",
		[String(limit)],
	);
}

/**
 * Get all entry unique names for SSG.
 * This function is used by generateStaticParams to pre-render all entry pages.
 */
export async function getAllEntryUniqueNames(): Promise<string[]> {
	const rows = await query<{ uniqueName: string }>(
		"SELECT unique_name AS uniqueName FROM tanahpedia_entry ORDER BY unique_name",
	);
	return rows.map((row) => row.uniqueName);
}

/**
 * Get all entity type params for SSG.
 * Note: Next.js generateStaticParams only supports path params, not search params.
 * Subcategories (role, kind, purity) are handled via search params at runtime,
 * so we only generate static params for base entity types here.
 */
export async function getAllEntityTypeParams(): Promise<
	Array<{ entityType: string }>
> {
	// Return all base entity types
	// Subcategories (person?role=prophet, animal?kind=behema, etc.) are handled
	// via search params at runtime, not in generateStaticParams
	return ENTITY_TYPES.map((entityType) => ({
		entityType: entityType.toLowerCase(),
	}));
}

// ─── Today in Tanah ─────────────────────────────────────────
// Returns events whose start_date Hebrew month+day matches the given month+day.

export interface TodayInTanahEvent {
	entityId: string;
	entityName: string;
	entryUniqueName: string | null;
	entryTitle: string | null;
	startDate: number | null;
}

export async function getTodayInTanahEvents(
	hebrewMonth: number,
	hebrewDay: number,
): Promise<TodayInTanahEvent[]> {
	const monthDay = hebrewMonth * 100 + hebrewDay;
	return query<TodayInTanahEvent>(
		`SELECT
		   e.id AS entityId,
		   e.name AS entityName,
		   ent.unique_name AS entryUniqueName,
		   ent.title AS entryTitle,
		   edr.start_date AS startDate
		 FROM tanahpedia_event_date_range edr
		 JOIN tanahpedia_event ev ON ev.id = edr.event_id
		 JOIN tanahpedia_entity e ON e.id = ev.entity_id
		 LEFT JOIN tanahpedia_entry_entity ee ON ee.entity_id = e.id
		 LEFT JOIN tanahpedia_entry ent ON ent.id = ee.entry_id
		 WHERE (edr.start_date % 10000) = ?
		 ORDER BY edr.start_date`,
		[String(monthDay)],
	);
}

// ─── Tanah al haperek integration ─────────────────────────
// Returns entity references for a given perek, used to render links in pasuk text.

export interface PerekEntityReference {
	entityId: string;
	entityName: string;
	entityType: EntityType;
	entryUniqueName: string | null;
	pasukNumber: number;
	segmentStart: number | null;
	segmentEnd: number | null;
}

export async function getEntityReferencesForPerek(
	perekId: number,
): Promise<PerekEntityReference[]> {
	try {
		return await query<PerekEntityReference>(
			`SELECT
			   ets.entity_id AS entityId,
			   e.name AS entityName,
			   e.entity_type AS entityType,
			   ent.unique_name AS entryUniqueName,
			   ets.pasuk_number AS pasukNumber,
			   ets.segment_start AS segmentStart,
			   ets.segment_end AS segmentEnd
			 FROM tanahpedia_entity_tanah_source ets
			 JOIN tanahpedia_entity e ON e.id = ets.entity_id
			 LEFT JOIN tanahpedia_entry_entity ee ON ee.entity_id = e.id
			 LEFT JOIN tanahpedia_entry ent ON ent.id = ee.entry_id
			 WHERE ets.perek_id = ?
			 ORDER BY ets.pasuk_number, ets.segment_start`,
			[String(perekId)],
		);
	} catch (error) {
		console.error(
			`Failed to fetch entity references for perek ${perekId}:`,
			error instanceof Error ? error.message : error,
		);
		return [];
	}
}
