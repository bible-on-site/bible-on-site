import { createServerFn } from "@tanstack/react-start";
import { execute, query, queryOne } from "../db";

export interface TanahpediaPlace {
	id: string;
	name: string;
}

export interface TanahpediaPlaceIdentification {
	id: string;
	place_id: string;
	modern_name: string | null;
	latitude: number | null;
	longitude: number | null;
}

export const getPlaces = createServerFn({ method: "GET" }).handler(async () => {
	return await query<TanahpediaPlace>(
		"SELECT id, name FROM tanahpedia_place ORDER BY name",
	);
});

export const getPlace = createServerFn({ method: "GET" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: id }) => {
		const place = await queryOne<TanahpediaPlace>(
			"SELECT id, name FROM tanahpedia_place WHERE id = ?",
			[id],
		);
		if (!place) throw new Error("Place not found");
		return place;
	});

export const getPlaceIdentifications = createServerFn({ method: "GET" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: placeId }) => {
		return await query<TanahpediaPlaceIdentification>(
			"SELECT id, place_id, modern_name, latitude, longitude FROM tanahpedia_place_identification WHERE place_id = ?",
			[placeId],
		);
	});

export const createPlace = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; name: string }) => data)
	.handler(async ({ data }) => {
		await execute("INSERT INTO tanahpedia_place (id, name) VALUES (?, ?)", [
			data.id,
			data.name,
		]);
		return { id: data.id };
	});

export const deletePlace = createServerFn({ method: "POST" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: id }) => {
		await execute("DELETE FROM tanahpedia_place WHERE id = ?", [id]);
		return { success: true };
	});
