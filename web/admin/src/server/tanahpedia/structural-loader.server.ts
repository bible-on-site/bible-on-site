import "@tanstack/react-start/server-only";
import type { EntityType } from "~/lib/tanahpedia/labels";
import { ADMIN_CREATABLE_ENTITY_TYPES } from "~/lib/tanahpedia/schema-registry";
import { query, queryOne } from "../db";

export type PersonSex = "MALE" | "FEMALE" | "UNKNOWN";

export interface PlaceIdentificationRow {
	id: string;
	modern_name: string | null;
	latitude: number | null;
	longitude: number | null;
}

export interface LinkedEntityStructural {
	linkId: string;
	entityId: string;
	entityType: EntityType;
	/** שם תצוגה מ־tanahpedia_entity.name */
	displayName: string;
	person?: {
		personId: string;
		mainName: string | null;
		mainNameRowId: string | null;
		sex: PersonSex | null;
		sexRowId: string | null;
	};
	place?: {
		placeId: string;
		identifications: PlaceIdentificationRow[];
	};
}

export interface EntryStructuralContext {
	entryId: string;
	linkedEntities: LinkedEntityStructural[];
}

const MAIN_NAME_TYPE = "MAIN";

function toNum(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	if (typeof v === "number" && !Number.isNaN(v)) return v;
	const n = Number.parseFloat(String(v));
	return Number.isFinite(n) ? n : null;
}

function isDbEntityType(t: string): t is EntityType {
	return (ADMIN_CREATABLE_ENTITY_TYPES as readonly string[]).includes(t);
}

export async function loadEntryStructuralContext(
	entryId: string,
): Promise<EntryStructuralContext> {
	const links = await query<{
		linkId: string;
		entityId: string;
		entityType: string;
		displayName: string;
	}>(
		`SELECT ee.id AS linkId, e.id AS entityId, e.entity_type AS entityType, e.name AS displayName
			 FROM tanahpedia_entry_entity ee
			 JOIN tanahpedia_entity e ON e.id = ee.entity_id
			 WHERE ee.entry_id = ?`,
		[entryId],
	);

	const linkedEntities: LinkedEntityStructural[] = [];

	for (const row of links) {
		if (!isDbEntityType(row.entityType)) continue;

		const base: LinkedEntityStructural = {
			linkId: row.linkId,
			entityId: row.entityId,
			entityType: row.entityType,
			displayName: row.displayName,
		};

		if (row.entityType === "PERSON") {
			const person = await queryOne<{ id: string }>(
				"SELECT id FROM tanahpedia_person WHERE entity_id = ? LIMIT 1",
				[row.entityId],
			);
			if (person) {
				const mainName = await queryOne<{ id: string; name: string }>(
					`SELECT pn.id, pn.name
						 FROM tanahpedia_person_name pn
						 INNER JOIN tanahpedia_lookup_name_type nt ON nt.id = pn.name_type_id
						 WHERE pn.person_id = ? AND nt.name = ? AND pn.alt_group_id IS NULL
						 LIMIT 1`,
					[person.id, MAIN_NAME_TYPE],
				);
				const sexRow = await queryOne<{ id: string; sex: PersonSex }>(
					`SELECT id, sex FROM tanahpedia_person_sex
						 WHERE person_id = ? AND alt_group_id IS NULL
						 ORDER BY id LIMIT 1`,
					[person.id],
				);
				base.person = {
					personId: person.id,
					mainName: mainName?.name ?? null,
					mainNameRowId: mainName?.id ?? null,
					sex: sexRow?.sex ?? null,
					sexRowId: sexRow?.id ?? null,
				};
			}
		}

		if (row.entityType === "PLACE") {
			const place = await queryOne<{ id: string }>(
				"SELECT id FROM tanahpedia_place WHERE entity_id = ? LIMIT 1",
				[row.entityId],
			);
			if (place) {
				const idents = await query<{
					id: string;
					modern_name: string | null;
					latitude: unknown;
					longitude: unknown;
				}>(
					`SELECT id, modern_name, latitude, longitude
						 FROM tanahpedia_place_identification
						 WHERE place_id = ?
						 ORDER BY id`,
					[place.id],
				);
				base.place = {
					placeId: place.id,
					identifications: idents.map((i) => ({
						id: i.id,
						modern_name: i.modern_name,
						latitude: toNum(i.latitude),
						longitude: toNum(i.longitude),
					})),
				};
			}
		}

		linkedEntities.push(base);
	}

	return { entryId, linkedEntities };
}