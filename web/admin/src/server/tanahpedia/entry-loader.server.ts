import "@tanstack/react-start/server-only";
import { queryOne } from "../db";

export interface TanahpediaEntryRow {
	id: string;
	unique_name: string;
	title: string;
	content: string | null;
	created_at: string;
	updated_at: string;
}

export async function loadTanahpediaEntryById(
	id: string,
): Promise<TanahpediaEntryRow | null> {
	return queryOne<TanahpediaEntryRow>(
		"SELECT id, unique_name, title, content, created_at, updated_at FROM tanahpedia_entry WHERE id = ?",
		[id],
	);
}