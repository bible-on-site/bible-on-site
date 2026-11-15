import "@tanstack/react-start/server-only";
import {
	type EntityExternalReference,
	EXTERNAL_REFERENCE_SUBJECT_KIND,
	isExternalReferenceSource,
} from "~/lib/tanahpedia/external-references";
import type { EntityType } from "~/lib/tanahpedia/labels";
import { ADMIN_CREATABLE_ENTITY_TYPES } from "~/lib/tanahpedia/schema-registry";
import { query } from "../db";

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
	saying?: {
		sayingId: string;
		sayingDate: number | null;
	};
	/** Verified external identifiers (JSON-LD sameAs) bound to the entity UUID. */
	externalReferences: EntityExternalReference[];
}

export interface EntryStructuralContext {
	entryId: string;
	linkedEntities: LinkedEntityStructural[];
}

const MAIN_NAME_TYPE = "MAIN";

function placeholders(count: number): string {
	return Array.from({ length: count }, () => "?").join(", ");
}

function toNum(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	if (typeof v === "number" && !Number.isNaN(v)) return v;
	const n = Number.parseFloat(String(v));
	return Number.isFinite(n) ? n : null;
}

function isDbEntityType(t: string): t is EntityType {
	return (ADMIN_CREATABLE_ENTITY_TYPES as readonly string[]).includes(t);
}

/** Runs `fn` only when there are ids to look up, so empty IN lists never hit SQL. */
async function whenAny<T>(ids: string[], fn: () => Promise<T[]>): Promise<T[]> {
	return ids.length === 0 ? [] : fn();
}

/** First row per key; callers ORDER BY so the winner matches the old LIMIT 1 queries. */
function firstPerKey<T>(rows: T[], keyOf: (row: T) => string): Map<string, T> {
	const map = new Map<string, T>();
	for (const row of rows) {
		const key = keyOf(row);
		if (!map.has(key)) map.set(key, row);
	}
	return map;
}

function groupByKey<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const row of rows) {
		const key = keyOf(row);
		const bucket = map.get(key);
		if (bucket) bucket.push(row);
		else map.set(key, [row]);
	}
	return map;
}

/** ER_NO_SUCH_TABLE — the external_reference deploy has not run here yet. */
function isMissingMysqlSchema(error: unknown): boolean {
	return (error as { code?: string })?.code === "ER_NO_SUCH_TABLE";
}

/**
 * Existing sameAs mappings for the linked entity ids, grouped by entity —
 * one batched lookup. A not-yet-deployed table reads as "no mappings",
 * matching the public website reader's tolerance.
 */
async function externalReferencesByEntity(
	entityIds: string[],
): Promise<Map<string, EntityExternalReference[]>> {
	const map = new Map<string, EntityExternalReference[]>();
	if (entityIds.length === 0) return map;
	try {
		const rows = await query<{
			subject_id: string;
			source: string;
			url: string;
		}>(
			`SELECT subject_id, source, url FROM external_reference
			 WHERE subject_kind = ? AND subject_id IN (${placeholders(entityIds.length)})
			 ORDER BY subject_id, source`,
			[EXTERNAL_REFERENCE_SUBJECT_KIND, ...entityIds],
		);
		for (const row of rows) {
			if (!isExternalReferenceSource(row.source)) continue;
			const bucket = map.get(row.subject_id) ?? [];
			bucket.push({ source: row.source, url: row.url });
			map.set(row.subject_id, bucket);
		}
	} catch (error) {
		if (isMissingMysqlSchema(error)) return map;
		throw error;
	}
	return map;
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

	// Batch per-entity lookups: one IN (...) query per type instead of up to
	// four sequential queries per linked entity.
	const personEntityIds = links
		.filter((r) => r.entityType === "PERSON")
		.map((r) => r.entityId);
	const placeEntityIds = links
		.filter((r) => r.entityType === "PLACE")
		.map((r) => r.entityId);
	const sayingEntityIds = links
		.filter((r) => r.entityType === "SAYING" || r.entityType === "PROPHECY")
		.map((r) => r.entityId);

	// External identifiers bind to the entity UUID — never the entry, subtype
	// row or name — so they load for every creatable linked entity in one
	// batch alongside the subtype lookups.
	const creatableEntityIds = links
		.filter((r) => isDbEntityType(r.entityType))
		.map((r) => r.entityId);

	const [externalRefs, persons, places, sayings] = await Promise.all([
		externalReferencesByEntity(creatableEntityIds),
		whenAny(personEntityIds, () =>
			query<{ entity_id: string; id: string }>(
				`SELECT entity_id, id FROM tanahpedia_person
				 WHERE entity_id IN (${placeholders(personEntityIds.length)})`,
				personEntityIds,
			),
		),
		whenAny(placeEntityIds, () =>
			query<{ entity_id: string; id: string }>(
				`SELECT entity_id, id FROM tanahpedia_place
				 WHERE entity_id IN (${placeholders(placeEntityIds.length)})`,
				placeEntityIds,
			),
		),
		whenAny(sayingEntityIds, () =>
			query<{ entity_id: string; id: string; saying_date: number | null }>(
				`SELECT entity_id, id, saying_date FROM tanahpedia_saying
				 WHERE entity_id IN (${placeholders(sayingEntityIds.length)})`,
				sayingEntityIds,
			),
		),
	]);

	const personIds = persons.map((p) => p.id);
	const placeIds = places.map((p) => p.id);

	const [mainNames, sexRows, identifications] = await Promise.all([
		whenAny(personIds, () =>
			query<{ person_id: string; id: string; name: string }>(
				`SELECT pn.person_id, pn.id, pn.name
					 FROM tanahpedia_person_name pn
					 INNER JOIN tanahpedia_lookup_name_type nt ON nt.id = pn.name_type_id
					 WHERE pn.person_id IN (${placeholders(personIds.length)}) AND nt.name = ? AND pn.alt_group_id IS NULL
					 ORDER BY pn.person_id, pn.id`,
				[...personIds, MAIN_NAME_TYPE],
			),
		),
		whenAny(personIds, () =>
			query<{ person_id: string; id: string; sex: PersonSex }>(
				`SELECT person_id, id, sex FROM tanahpedia_person_sex
					 WHERE person_id IN (${placeholders(personIds.length)}) AND alt_group_id IS NULL
					 ORDER BY person_id, id`,
				personIds,
			),
		),
		whenAny(placeIds, () =>
			query<{
				place_id: string;
				id: string;
				modern_name: string | null;
				latitude: unknown;
				longitude: unknown;
			}>(
				`SELECT place_id, id, modern_name, latitude, longitude
					 FROM tanahpedia_place_identification
					 WHERE place_id IN (${placeholders(placeIds.length)})
					 ORDER BY place_id, id`,
				placeIds,
			),
		),
	]);

	const personByEntity = firstPerKey(persons, (p) => p.entity_id);
	const placeByEntity = firstPerKey(places, (p) => p.entity_id);
	const sayingByEntity = firstPerKey(sayings, (s) => s.entity_id);
	const mainNameByPerson = firstPerKey(mainNames, (n) => n.person_id);
	const sexByPerson = firstPerKey(sexRows, (s) => s.person_id);
	const identsByPlace = groupByKey(identifications, (i) => i.place_id);

	const linkedEntities: LinkedEntityStructural[] = [];

	for (const row of links) {
		if (!isDbEntityType(row.entityType)) continue;

		const base: LinkedEntityStructural = {
			linkId: row.linkId,
			entityId: row.entityId,
			entityType: row.entityType,
			displayName: row.displayName,
			externalReferences: externalRefs.get(row.entityId) ?? [],
		};

		if (row.entityType === "PERSON") {
			const person = personByEntity.get(row.entityId);
			if (person) {
				const mainName = mainNameByPerson.get(person.id);
				const sexRow = sexByPerson.get(person.id);
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
			const place = placeByEntity.get(row.entityId);
			if (place) {
				base.place = {
					placeId: place.id,
					identifications: (identsByPlace.get(place.id) ?? []).map((i) => ({
						id: i.id,
						modern_name: i.modern_name,
						latitude: toNum(i.latitude),
						longitude: toNum(i.longitude),
					})),
				};
			}
		}

		if (row.entityType === "SAYING" || row.entityType === "PROPHECY") {
			const saying = sayingByEntity.get(row.entityId);
			if (saying) {
				base.saying = {
					sayingId: saying.id,
					sayingDate: saying.saying_date,
				};
			}
		}

		linkedEntities.push(base);
	}

	return { entryId, linkedEntities };
}
