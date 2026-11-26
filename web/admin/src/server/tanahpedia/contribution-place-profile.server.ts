import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import {
	type PlaceProfileChange,
	type PlaceProfileInput,
	placeOccurrenceKey,
} from "~/lib/tanahpedia/contribution-place-profile";
import {
	type ChangeState,
	type ReviewedChange,
	sameState,
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

/** Snapshot exactly the canonical facts touched by this additive proposal. */
export async function readPlaceProfileBase(
	conn: PoolConnection,
	targetId: string,
	desired: PlaceProfileChange,
): Promise<ChangeState | null> {
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
	const point = desired.identification;
	const alreadyIdentified =
		point &&
		(await txQueryOne<{ id: string }>(
			conn,
			"SELECT id FROM tanahpedia_place_identification WHERE place_id=? AND modern_name=? AND latitude=? AND longitude=? LIMIT 1 FOR UPDATE",
			[targetId, point.modernName, point.latitude, point.longitude],
		));
	return {
		entry: null,
		occurrences: desired.occurrences.filter((occurrence) =>
			existing.has(placeOccurrenceKey(occurrence)),
		),
		identification: alreadyIdentified ? point : null,
	} as unknown as ChangeState;
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
	if (!refresh && sameState(before, after))
		throw new Error("All proposed place facts are already present");
	const labels: Record<string, string> = Object.fromEntries(
		words.map((word) => [placeOccurrenceKey(word), word.citation]),
	);
	labels.place =
		input.after.entry?.displayName ?? (await readPlace(conn, targetId)).name;
	return { kind: "place_profile", targetId, before, after, labels };
}

export async function applyPlaceProfile(
	conn: PoolConnection,
	placeId: string,
	desired: PlaceProfileChange,
	before: PlaceProfileChange | null,
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
	if (!point || before?.identification) return;
	const identificationId = randomUUID();
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
	const groupId = randomUUID();
	await txExecute(
		conn,
		"INSERT INTO tanahpedia_source_group (id,target_table,target_id) VALUES (?,'tanahpedia_place_identification',?)",
		[groupId, identificationId],
	);
	for (const citation of new Set([point.citation, point.coordinateCitation]))
		await txExecute(
			conn,
			"INSERT INTO tanahpedia_non_tanah_source (id,source_group_id,source_text) VALUES (?,?,?)",
			[randomUUID(), groupId, citation],
		);
}
