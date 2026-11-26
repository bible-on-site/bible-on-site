import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import {
	type PlaceProfileBase,
	type PlaceProfileChange,
	type PlaceProfileInput,
	placeIdentificationCitations,
	placeOccurrenceKey,
	placeProfileHasEffect,
} from "~/lib/tanahpedia/contribution-place-profile";
import type {
	ChangeState,
	ReviewedChange,
} from "~/lib/tanahpedia/contributions";
import { txExecute, txQuery, txQueryOne } from "../db";
import { validateScriptureOccurrences } from "./contribution-scripture-occurrences.server";

async function readPlace(conn: PoolConnection, id: string) {
	const place = await txQueryOne<{ entityId: string; name: string }>(
		conn,
		"SELECT p.entity_id AS entityId,e.name FROM tanahpedia_place p JOIN tanahpedia_entity e ON e.id=p.entity_id WHERE p.id=? FOR UPDATE",
		[id],
	);
	if (!place) throw new Error("The existing place no longer exists");
	return place;
}

async function readEntryAddresses(conn: PoolConnection, entityId: string) {
	const entries = await txQuery<{ address: string }>(
		conn,
		`SELECT e.unique_name AS address FROM tanahpedia_entry_entity ee
		JOIN tanahpedia_entry e ON e.id=ee.entry_id
		WHERE ee.entity_id=? AND e.unique_name<>'' ORDER BY e.unique_name,e.id FOR SHARE`,
		[entityId],
	);
	if (!entries.length)
		throw new Error(
			"Word links require an existing Tanahpedia entry destination for the place",
		);
	return entries.map(({ address }) => address);
}

async function readIdentificationBase(
	conn: PoolConnection,
	placeId: string,
	point: PlaceProfileChange["identification"],
): Promise<PlaceProfileBase["identification"]> {
	if (!point) return null;
	const existing = await txQueryOne<{ id: string }>(
		conn,
		`SELECT id FROM tanahpedia_place_identification
		WHERE place_id=? AND modern_name=? AND latitude=? AND longitude=?
		ORDER BY id LIMIT 1 FOR UPDATE`,
		[placeId, point.modernName, point.latitude, point.longitude],
	);
	if (!existing) return null;
	const rows = await txQuery<{ citation: string }>(
		conn,
		`SELECT s.source_text AS citation FROM tanahpedia_source_group g
		JOIN tanahpedia_non_tanah_source s ON s.source_group_id=g.id
		WHERE g.target_table='tanahpedia_place_identification' AND g.target_id=? FOR UPDATE`,
		[existing.id],
	);
	const storedCitations = new Set(rows.map(({ citation }) => citation));
	return {
		id: existing.id,
		citations: placeIdentificationCitations(point).filter((citation) =>
			storedCitations.has(citation),
		),
	};
}

/** Snapshot exactly the canonical facts touched by this additive proposal. */
export async function readPlaceProfileBase(
	conn: PoolConnection,
	targetId: string,
	desired: PlaceProfileChange,
): Promise<PlaceProfileBase | null> {
	if (desired.entry) {
		const created = await txQueryOne<{ id: string }>(
			conn,
			"SELECT id FROM tanahpedia_entry WHERE id=? FOR UPDATE",
			[targetId],
		);
		if (created)
			throw new Error("The proposed entry already exists. Refresh its diff.");
		return null;
	}
	const place = await readPlace(conn, targetId);
	const entryAddresses = desired.occurrences.length
		? await readEntryAddresses(conn, place.entityId)
		: [];
	const stored = await txQuery<{
		perekId: number;
		pasukNumber: number;
		segmentStart: number;
		segmentEnd: number;
	}>(
		conn,
		"SELECT perek_id AS perekId,pasuk_number AS pasukNumber,segment_start AS segmentStart,segment_end AS segmentEnd FROM tanahpedia_entity_tanah_source WHERE entity_id=? AND segment_start IS NOT NULL AND segment_end IS NOT NULL FOR UPDATE",
		[place.entityId],
	);
	const existing = new Set(stored.map(placeOccurrenceKey));
	return {
		entryAddresses,
		occurrences: desired.occurrences.filter((occurrence) =>
			existing.has(placeOccurrenceKey(occurrence)),
		),
		identification: await readIdentificationBase(
			conn,
			targetId,
			desired.identification,
		),
	};
}

export async function preparePlaceProfile(
	conn: PoolConnection,
	input: PlaceProfileInput,
	refresh: boolean,
): Promise<ReviewedChange> {
	const targetId = input.targetId ?? randomUUID();
	const before = await readPlaceProfileBase(conn, targetId, input.after);
	const words = await validateScriptureOccurrences(input.after.occurrences);
	const after = input.after as unknown as ChangeState;
	if (!refresh && !placeProfileHasEffect(before, input.after))
		throw new Error("All proposed place facts are already present");
	const labels: Record<string, string> = Object.fromEntries(
		words.map((word) => [placeOccurrenceKey(word), word.citation]),
	);
	labels.place =
		input.after.entry?.displayName ?? (await readPlace(conn, targetId)).name;
	return {
		kind: "place_profile",
		targetId,
		before: before as unknown as ChangeState | null,
		after,
		labels,
	};
}

export async function applyPlaceProfile(
	conn: PoolConnection,
	placeId: string,
	desired: PlaceProfileChange,
	before: PlaceProfileBase | null,
): Promise<void> {
	await validateScriptureOccurrences(desired.occurrences);
	const place = await readPlace(conn, placeId);
	const existing = new Set(before?.occurrences.map(placeOccurrenceKey));
	const additions = desired.occurrences
		.filter((occurrence) => !existing.has(placeOccurrenceKey(occurrence)))
		.map((occurrence) => ({ ...occurrence, id: randomUUID() }));
	if (additions.length)
		await txExecute(
			conn,
			`INSERT INTO tanahpedia_entity_tanah_source (id,entity_id,perek_id,pasuk_number,segment_start,segment_end)
			SELECT occurrence.id,?,occurrence.perek_id,occurrence.pasuk_number,occurrence.segment_start,occurrence.segment_end
			FROM JSON_TABLE(?, '$[*]' COLUMNS (
				id CHAR(36) PATH '$.id',perek_id INT PATH '$.perekId',pasuk_number INT PATH '$.pasukNumber',
				segment_start INT PATH '$.segmentStart',segment_end INT PATH '$.segmentEnd'
			)) AS occurrence`,
			[place.entityId, JSON.stringify(additions)],
		);
	const point = desired.identification;
	if (!point) return;
	const existingPoint = before?.identification;
	const citations = placeIdentificationCitations(point).filter(
		(citation) => !existingPoint?.citations.includes(citation),
	);
	if (!citations.length) return;
	const identificationId = existingPoint?.id ?? randomUUID();
	if (!existingPoint)
		await txExecute(
			conn,
			"INSERT INTO tanahpedia_place_identification (id,place_id,modern_name,latitude,longitude) VALUES (?,?,?,?,?)",
			[
				identificationId,
				placeId,
				point.modernName,
				point.latitude,
				point.longitude,
			],
		);
	const existingGroup = existingPoint
		? await txQueryOne<{ id: string }>(
				conn,
				`SELECT id FROM tanahpedia_source_group
				WHERE target_table='tanahpedia_place_identification' AND target_id=?
				ORDER BY id LIMIT 1 FOR UPDATE`,
				[identificationId],
			)
		: null;
	const groupId = existingGroup?.id ?? randomUUID();
	if (!existingGroup)
		await txExecute(
			conn,
			"INSERT INTO tanahpedia_source_group (id,target_table,target_id) VALUES (?,'tanahpedia_place_identification',?)",
			[groupId, identificationId],
		);
	for (const citation of citations)
		await txExecute(
			conn,
			"INSERT INTO tanahpedia_non_tanah_source (id,source_group_id,source_text) VALUES (?,?,?)",
			[randomUUID(), groupId, citation],
		);
}
