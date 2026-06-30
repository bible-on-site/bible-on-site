import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { execute, query, queryOne } from "../db";

export interface TanahpediaPlace {
	id: string;
	entity_id: string;
	name: string;
}

export interface TanahpediaPlaceIdentification {
	id: string;
	place_id: string;
	modern_name: string | null;
	latitude: number | null;
	longitude: number | null;
}

function toNum(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	if (typeof v === "number" && !Number.isNaN(v)) return v;
	const n = Number.parseFloat(String(v));
	return Number.isFinite(n) ? n : null;
}

export const getPlaces = createServerFn({ method: "GET" }).handler(async () => {
	return await query<TanahpediaPlace>(
		`SELECT p.id, p.entity_id, e.name AS name
		 FROM tanahpedia_place p
		 INNER JOIN tanahpedia_entity e ON e.id = p.entity_id
		 ORDER BY e.name`,
	);
});

export const getPlace = createServerFn({ method: "GET" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: id }) => {
		const place = await queryOne<TanahpediaPlace>(
			`SELECT p.id, p.entity_id, e.name AS name
			 FROM tanahpedia_place p
			 INNER JOIN tanahpedia_entity e ON e.id = p.entity_id
			 WHERE p.id = ?`,
			[id],
		);
		if (!place) throw new Error("Place not found");
		return place;
	});

export const getPlaceIdentifications = createServerFn({ method: "GET" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: placeId }) => {
		const rows = await query<{
			id: string;
			place_id: string;
			modern_name: string | null;
			latitude: unknown;
			longitude: unknown;
		}>(
			"SELECT id, place_id, modern_name, latitude, longitude FROM tanahpedia_place_identification WHERE place_id = ?",
			[placeId],
		);
		return rows.map((r) => ({
			...r,
			latitude: toNum(r.latitude),
			longitude: toNum(r.longitude),
		})) as TanahpediaPlaceIdentification[];
	});

export const createPlace = createServerFn({ method: "POST" })
	.inputValidator((data: { name: string }) => data)
	.handler(async ({ data }) => {
		const name = data.name.trim();
		if (!name) throw new Error("שם מקום ריק");
		const entityId = randomUUID();
		const placeId = randomUUID();
		await execute(
			`INSERT INTO tanahpedia_entity (id, entity_type, name) VALUES (?, 'PLACE', ?)`,
			[entityId, name],
		);
		await execute(
			`INSERT INTO tanahpedia_place (id, entity_id) VALUES (?, ?)`,
			[placeId, entityId],
		);
		return { id: placeId, entity_id: entityId };
	});

export const deletePlace = createServerFn({ method: "POST" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: id }) => {
		const row = await queryOne<{ entity_id: string }>(
			"SELECT entity_id FROM tanahpedia_place WHERE id = ?",
			[id],
		);
		if (!row) throw new Error("Place not found");
		await execute("DELETE FROM tanahpedia_entity WHERE id = ?", [
			row.entity_id,
		]);
		return { success: true };
	});
