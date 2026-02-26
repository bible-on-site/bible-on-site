import { createServerFn } from "@tanstack/react-start";
import { execute, query, queryOne } from "./db";
import { getAuthorImageUrl } from "./s3";

// imageUrl is computed at runtime from the author ID (S3 key: authors/high-res/{id}.jpg).
// There is NO image_url column in tanah_author — do not add one.
export interface Author {
	id: number;
	name: string;
	details: string;
	imageUrl: string;
}

export interface AuthorFormData {
	name: string;
	details: string;
}

interface AuthorRow {
	id: number;
	name: string;
	details: string;
}

function toAuthor(row: AuthorRow): Author {
	return {
		id: row.id,
		name: row.name,
		details: row.details,
		imageUrl: getAuthorImageUrl(row.id),
	};
}

// Get all authors
export const getAuthors = createServerFn({ method: "GET" }).handler(
	async () => {
		const rows = await query<AuthorRow>(
			"SELECT id, name, details FROM tanah_author ORDER BY name",
		);
		return rows.map(toAuthor);
	},
);

// Get author by ID
export const getAuthor = createServerFn({ method: "GET" })
	.inputValidator((data: number) => data)
	.handler(async ({ data: id }) => {
		const row = await queryOne<AuthorRow>(
			"SELECT id, name, details FROM tanah_author WHERE id = ?",
			[id],
		);

		if (!row) {
			throw new Error("Author not found");
		}

		return toAuthor(row);
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

		const row = await queryOne<AuthorRow>(
			"SELECT id, name, details FROM tanah_author WHERE id = ?",
			[result.insertId],
		);

		if (!row) {
			throw new Error("Failed to retrieve created author");
		}

		return toAuthor(row);
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

		const row = await queryOne<AuthorRow>(
			"SELECT id, name, details FROM tanah_author WHERE id = ?",
			[data.id],
		);

		if (!row) {
			throw new Error("Failed to retrieve updated author");
		}

		return toAuthor(row);
	});

// Delete author
export const deleteAuthor = createServerFn({ method: "POST" })
	.inputValidator((data: number) => data)
	.handler(async ({ data: id }) => {
		await execute("DELETE FROM tanah_author WHERE id = ?", [id]);
		return { success: true };
	});
