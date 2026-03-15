import { createServerFn } from "@tanstack/react-start";
import { execute, query, queryOne } from "../db";

export interface TanahpediaEntry {
	id: string;
	unique_name: string;
	title: string;
	content: string | null;
	created_at: string;
	updated_at: string;
}

export interface TanahpediaEntryEntity {
	id: string;
	entry_id: string;
	entity_type: string;
	entity_id: string;
}

export const getEntries = createServerFn({ method: "GET" }).handler(
	async () => {
		return await query<Omit<TanahpediaEntry, "content">>(
			"SELECT id, unique_name, title, created_at, updated_at FROM tanahpedia_entry ORDER BY title",
		);
	},
);

export const getEntry = createServerFn({ method: "GET" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: id }) => {
		const entry = await queryOne<TanahpediaEntry>(
			"SELECT id, unique_name, title, content, created_at, updated_at FROM tanahpedia_entry WHERE id = ?",
			[id],
		);
		if (!entry) throw new Error("Entry not found");
		return entry;
	});

export const createEntry = createServerFn({ method: "POST" })
	.inputValidator(
		(data: {
			id: string;
			unique_name: string;
			title: string;
			content: string;
		}) => data,
	)
	.handler(async ({ data }) => {
		await execute(
			"INSERT INTO tanahpedia_entry (id, unique_name, title, content) VALUES (?, ?, ?, ?)",
			[data.id, data.unique_name, data.title, data.content || null],
		);
		return await queryOne<TanahpediaEntry>(
			"SELECT id, unique_name, title, content, created_at, updated_at FROM tanahpedia_entry WHERE id = ?",
			[data.id],
		);
	});

export const updateEntry = createServerFn({ method: "POST" })
	.inputValidator(
		(data: {
			id: string;
			unique_name: string;
			title: string;
			content: string;
		}) => data,
	)
	.handler(async ({ data }) => {
		await execute(
			"UPDATE tanahpedia_entry SET unique_name = ?, title = ?, content = ? WHERE id = ?",
			[data.unique_name, data.title, data.content || null, data.id],
		);
		return await queryOne<TanahpediaEntry>(
			"SELECT id, unique_name, title, content, created_at, updated_at FROM tanahpedia_entry WHERE id = ?",
			[data.id],
		);
	});

export const deleteEntry = createServerFn({ method: "POST" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: id }) => {
		await execute("DELETE FROM tanahpedia_entry WHERE id = ?", [id]);
		return { success: true };
	});

export const getEntryEntities = createServerFn({ method: "GET" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: entryId }) => {
		return await query<TanahpediaEntryEntity>(
			"SELECT id, entry_id, entity_type, entity_id FROM tanahpedia_entry_entity WHERE entry_id = ?",
			[entryId],
		);
	});

export const assignEntity = createServerFn({ method: "POST" })
	.inputValidator(
		(data: {
			id: string;
			entry_id: string;
			entity_type: string;
			entity_id: string;
		}) => data,
	)
	.handler(async ({ data }) => {
		await execute(
			"INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_type, entity_id) VALUES (?, ?, ?, ?)",
			[data.id, data.entry_id, data.entity_type, data.entity_id],
		);
		return { success: true };
	});

export const removeEntity = createServerFn({ method: "POST" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: id }) => {
		await execute("DELETE FROM tanahpedia_entry_entity WHERE id = ?", [id]);
		return { success: true };
	});
