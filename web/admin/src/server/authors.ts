import { createServerFn } from "@tanstack/react-start";
import { query, queryOne, execute } from "./db";

export interface Author {
	id: number;
	name: string;
	details: string;
	imageUrl: string | null;
}

export interface AuthorFormData {
	name: string;
	details: string;
}

// Get all authors
export const getAuthors = createServerFn({ method: "GET" }).handler(
	async () => {
		const authors = await query<{
			id: number;
			name: string;
			details: string;
			image_url?: string;
		}>("SELECT id, name, details, image_url FROM tanah_author ORDER BY name");

		return authors.map((a) => ({
			id: a.id,
			name: a.name,
			details: a.details,
			imageUrl: a.image_url || null,
		}));
	},
);

// Get author by ID
export const getAuthor = createServerFn({ method: "GET" })
	.inputValidator((data: number) => data)
	.handler(async ({ data: id }) => {
		const author = await queryOne<{
			id: number;
			name: string;
			details: string;
			image_url?: string;
		}>("SELECT id, name, details, image_url FROM tanah_author WHERE id = ?", [id]);

		if (!author) {
			throw new Error("Author not found");
		}

		return {
			id: author.id,
			name: author.name,
			details: author.details,
			imageUrl: author.image_url || null,
		};
	});

// Create author
export const createAuthor = createServerFn({ method: "POST" })
	.inputValidator((data: AuthorFormData) => data)
	.handler(async ({ data }) => {
		if (!data.name) {
			throw new Error("Name is required");
		}

		const result = await execute(
			"INSERT INTO tanah_author (name, details) VALUES (?, ?)",
			[data.name, data.details || ""],
		);

		const newAuthor = await queryOne<{
			id: number;
			name: string;
			details: string;
		}>("SELECT id, name, details FROM tanah_author WHERE id = ?", [
			result.insertId,
		]);

		return {
			id: newAuthor!.id,
			name: newAuthor!.name,
			details: newAuthor!.details,
			imageUrl: null,
		};
	});

// Update author
export const updateAuthor = createServerFn({ method: "POST" })
	.inputValidator((data: { id: number } & AuthorFormData) => data)
	.handler(async ({ data }) => {
		if (!data.name) {
			throw new Error("Name is required");
		}

		await execute(
			"UPDATE tanah_author SET name = ?, details = ? WHERE id = ?",
			[data.name, data.details || "", data.id],
		);

		const updated = await queryOne<{
			id: number;
			name: string;
			details: string;
		}>("SELECT id, name, details FROM tanah_author WHERE id = ?", [data.id]);

		return {
			id: updated!.id,
			name: updated!.name,
			details: updated!.details,
			imageUrl: null,
		};
	});

// Delete author
export const deleteAuthor = createServerFn({ method: "POST" })
	.inputValidator((data: number) => data)
	.handler(async ({ data: id }) => {
		await execute("DELETE FROM tanah_author WHERE id = ?", [id]);
		return { success: true };
	});
