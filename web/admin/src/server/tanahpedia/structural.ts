import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import type { EntityType } from "~/lib/tanahpedia/labels";
import { ADMIN_CREATABLE_ENTITY_TYPES } from "~/lib/tanahpedia/schema-registry";
import { execute, query, queryOne } from "../db";
import {
	type EntryStructuralContext,
	type LinkedEntityStructural,
	loadEntryStructuralContext,
	type PersonSex,
	type PlaceIdentificationRow,
} from "./structural-loader.server";

const MAIN_NAME_TYPE = "MAIN";

export type {
	EntryStructuralContext,
	LinkedEntityStructural,
	PersonSex,
	PlaceIdentificationRow,
};

async function getMainNameTypeId(): Promise<string> {
	const row = await queryOne<{ id: string }>(
		"SELECT id FROM tanahpedia_lookup_name_type WHERE name = ? LIMIT 1",
		[MAIN_NAME_TYPE],
	);
	if (!row) {
		throw new Error(
			`Missing tanahpedia_lookup_name_type row for name=${MAIN_NAME_TYPE}`,
		);
	}
	return row.id;
}

export const getEntryStructuralContext = createServerFn({ method: "GET" })
	.validator((data: string) => data)
	.handler(async ({ data: entryId }): Promise<EntryStructuralContext> => {
		return loadEntryStructuralContext(entryId);
	});

export const updateEntityDisplayName = createServerFn({ method: "POST" })
	.validator((data: { entityId: string; name: string }) => data)
	.handler(async ({ data }) => {
		const name = data.name.trim();
		if (!name) throw new Error("שם יישות ריק");
		await execute("UPDATE tanahpedia_entity SET name = ? WHERE id = ?", [
			name,
			data.entityId,
		]);
		return { success: true };
	});

export const updatePersonMainName = createServerFn({ method: "POST" })
	.validator(
		(data: { personId: string; name: string; mainNameRowId?: string | null }) =>
			data,
	)
	.handler(async ({ data }) => {
		const name = data.name.trim();
		if (!name) throw new Error("שם ריק");
		const typeId = await getMainNameTypeId();

		if (data.mainNameRowId) {
			await execute(
				"UPDATE tanahpedia_person_name SET name = ? WHERE id = ? AND person_id = ?",
				[name, data.mainNameRowId, data.personId],
			);
		} else {
			const id = randomUUID();
			await execute(
				`INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
				 VALUES (?, ?, ?, ?, NULL)`,
				[id, data.personId, name, typeId],
			);
		}

		const entity = await queryOne<{ entity_id: string }>(
			"SELECT entity_id FROM tanahpedia_person WHERE id = ?",
			[data.personId],
		);
		if (entity) {
			await execute("UPDATE tanahpedia_entity SET name = ? WHERE id = ?", [
				name,
				entity.entity_id,
			]);
		}

		return { success: true };
	});

export const updatePersonSex = createServerFn({ method: "POST" })
	.validator(
		(data: { personId: string; sex: PersonSex; sexRowId?: string | null }) =>
			data,
	)
	.handler(async ({ data }) => {
		if (data.sexRowId) {
			await execute(
				"UPDATE tanahpedia_person_sex SET sex = ? WHERE id = ? AND person_id = ?",
				[data.sex, data.sexRowId, data.personId],
			);
		} else {
			await execute(
				"DELETE FROM tanahpedia_person_sex WHERE person_id = ? AND alt_group_id IS NULL",
				[data.personId],
			);
			await execute(
				`INSERT INTO tanahpedia_person_sex (id, person_id, sex, alt_group_id)
				 VALUES (?, ?, ?, NULL)`,
				[randomUUID(), data.personId, data.sex],
			);
		}
		return { success: true };
	});

export interface PlaceIdentificationInput {
	id?: string;
	modern_name: string | null;
	latitude: number | null;
	longitude: number | null;
}

export const replacePlaceIdentifications = createServerFn({ method: "POST" })
	.validator(
		(data: { placeId: string; rows: PlaceIdentificationInput[] }) => data,
	)
	.handler(async ({ data }) => {
		const existing = await query<{ id: string }>(
			"SELECT id FROM tanahpedia_place_identification WHERE place_id = ?",
			[data.placeId],
		);
		const keepIds = new Set(
			data.rows.map((r) => r.id).filter((x): x is string => Boolean(x)),
		);
		for (const row of existing) {
			if (!keepIds.has(row.id)) {
				await execute(
					"DELETE FROM tanahpedia_place_identification WHERE id = ?",
					[row.id],
				);
			}
		}
		for (const r of data.rows) {
			if (r.id) {
				await execute(
					`UPDATE tanahpedia_place_identification
					 SET modern_name = ?, latitude = ?, longitude = ?
					 WHERE id = ? AND place_id = ?`,
					[r.modern_name, r.latitude, r.longitude, r.id, data.placeId],
				);
			} else {
				await execute(
					`INSERT INTO tanahpedia_place_identification (id, place_id, modern_name, latitude, longitude, alt_group_id)
					 VALUES (?, ?, ?, ?, ?, NULL)`,
					[randomUUID(), data.placeId, r.modern_name, r.latitude, r.longitude],
				);
			}
		}
		return { success: true };
	});

/** Subtype tables that only need `(id, entity_id)`. */
const SIMPLE_SUBTYPE_TABLES: Partial<Record<EntityType, string>> = {
	PERSON: "tanahpedia_person",
	PLACE: "tanahpedia_place",
	EVENT: "tanahpedia_event",
	ANIMAL: "tanahpedia_animal",
	OBJECT: "tanahpedia_object",
	PLANT: "tanahpedia_plant",
	ASTRONOMICAL_OBJECT: "tanahpedia_astronomical_object",
	SAYING: "tanahpedia_saying",
	SEFER: "tanahpedia_sefer",
	NATION: "tanahpedia_nation",
};

/** Specialisations that also need a row of their parent type. */
const DERIVED_SUBTYPES: Partial<
	Record<
		EntityType,
		{ table: string; parentTable: string; parentColumn: string }
	>
> = {
	WAR: {
		table: "tanahpedia_war",
		parentTable: "tanahpedia_event",
		parentColumn: "event_id",
	},
	TEMPLE_TOOL: {
		table: "tanahpedia_temple_tool",
		parentTable: "tanahpedia_object",
		parentColumn: "object_id",
	},
	PROPHECY: {
		table: "tanahpedia_prophecy",
		parentTable: "tanahpedia_saying",
		parentColumn: "saying_id",
	},
};

async function insertSubtypeRows(
	entityType: EntityType,
	entityId: string,
	name: string,
): Promise<void> {
	const derived = DERIVED_SUBTYPES[entityType];
	if (derived) {
		const parentId = randomUUID();
		await execute(
			`INSERT INTO ${derived.parentTable} (id, entity_id) VALUES (?, ?)`,
			[parentId, entityId],
		);
		await execute(
			`INSERT INTO ${derived.table} (id, ${derived.parentColumn}, entity_id) VALUES (?, ?, ?)`,
			[randomUUID(), parentId, entityId],
		);
		return;
	}

	const table = SIMPLE_SUBTYPE_TABLES[entityType];
	if (!table) throw new Error("סוג יישות לא נתמך ליצירה");

	const subtypeId = randomUUID();
	await execute(`INSERT INTO ${table} (id, entity_id) VALUES (?, ?)`, [
		subtypeId,
		entityId,
	]);

	if (entityType === "PERSON") {
		const typeId = await getMainNameTypeId();
		await execute(
			`INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
			 VALUES (?, ?, ?, ?, NULL)`,
			[randomUUID(), subtypeId, name, typeId],
		);
	}
}

export const createEntityAndLinkToEntry = createServerFn({ method: "POST" })
	.validator(
		(data: { entryId: string; entityType: EntityType; displayName: string }) =>
			data,
	)
	.handler(async ({ data }) => {
		if (
			!(ADMIN_CREATABLE_ENTITY_TYPES as readonly string[]).includes(
				data.entityType,
			)
		) {
			throw new Error("סוג יישות לא נתמך ליצירה");
		}
		const name = data.displayName.trim();
		if (!name) throw new Error("שם ריק");

		const entityId = randomUUID();
		const linkId = randomUUID();

		await execute(
			`INSERT INTO tanahpedia_entity (id, entity_type, name) VALUES (?, ?, ?)`,
			[entityId, data.entityType, name],
		);

		await insertSubtypeRows(data.entityType, entityId, name);

		await execute(
			`INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id) VALUES (?, ?, ?)`,
			[linkId, data.entryId, entityId],
		);

		return { entityId, linkId };
	});

export interface EntitySearchResult {
	entityId: string;
	entityType: EntityType;
	name: string;
}

/** Existing entities to link, newest-relevant first; excludes ones already linked. */
export const searchEntities = createServerFn({ method: "POST" })
	.validator(
		(data: { entryId: string; query: string; entityType?: EntityType }) => data,
	)
	.handler(async ({ data }): Promise<EntitySearchResult[]> => {
		const term = `%${data.query.trim()}%`;
		const params: unknown[] = [data.entryId, term];
		let typeFilter = "";
		if (data.entityType) {
			typeFilter = " AND e.entity_type = ?";
			params.push(data.entityType);
		}
		return await query<EntitySearchResult>(
			`SELECT e.id AS entityId, e.entity_type AS entityType, e.name AS name
			   FROM tanahpedia_entity e
			  WHERE e.id NOT IN (
			        SELECT entity_id FROM tanahpedia_entry_entity WHERE entry_id = ?
			      )
			    AND e.name LIKE ?${typeFilter}
			  ORDER BY e.name
			  LIMIT 20`,
			params,
		);
	});

export const linkExistingEntityToEntry = createServerFn({ method: "POST" })
	.validator((data: { entryId: string; entityId: string }) => data)
	.handler(async ({ data }) => {
		const existing = await queryOne<{ id: string }>(
			`SELECT id FROM tanahpedia_entry_entity WHERE entry_id = ? AND entity_id = ?`,
			[data.entryId, data.entityId],
		);
		if (existing) return { linkId: existing.id };

		const linkId = randomUUID();
		await execute(
			`INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id) VALUES (?, ?, ?)`,
			[linkId, data.entryId, data.entityId],
		);
		return { linkId };
	});
