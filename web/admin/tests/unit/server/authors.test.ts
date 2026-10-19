import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, queryMock, queryOneMock } = vi.hoisted(() => ({
	executeMock: vi.fn(),
	queryMock: vi.fn(),
	queryOneMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
}));

vi.mock("~/server/db", () => ({
	execute: executeMock,
	query: queryMock,
	queryOne: queryOneMock,
}));

vi.mock("~/server/s3", () => ({
	getAuthorImageUrl: (id: number) => `https://img.example.com/${id}.jpg`,
}));

import {
	createAuthor,
	deleteAuthor,
	getAuthor,
	getAuthors,
	updateAuthor,
} from "~/server/authors";

describe("authors api", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue({ insertId: 7 });
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
	});

	it("lists authors with derived image urls", async () => {
		queryMock.mockResolvedValue([{ id: 1, name: 'רש"י', details: "פירוש" }]);

		await expect(getAuthors()).resolves.toEqual([
			{
				id: 1,
				name: 'רש"י',
				details: "פירוש",
				imageUrl: "https://img.example.com/1.jpg",
			},
		]);
	});

	it("returns one author by id", async () => {
		queryOneMock.mockResolvedValue({ id: 2, name: 'רמב"ם', details: "" });

		await expect(getAuthor({ data: 2 })).resolves.toEqual({
			id: 2,
			name: 'רמב"ם',
			details: "",
			imageUrl: "https://img.example.com/2.jpg",
		});
		expect(queryOneMock.mock.calls[0]?.[1]).toEqual([2]);
	});

	it("throws for a missing author", async () => {
		queryOneMock.mockResolvedValue(null);

		await expect(getAuthor({ data: 99 })).rejects.toThrow("Author not found");
	});

	it("requires a name when creating", async () => {
		await expect(
			createAuthor({ data: { name: "", details: "x" } }),
		).rejects.toThrow("Name is required");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("inserts and returns the created author", async () => {
		queryOneMock.mockResolvedValue({ id: 7, name: "אבן עזרא", details: "" });

		await expect(
			createAuthor({ data: { name: "אבן עזרא", details: "" } }),
		).resolves.toMatchObject({ id: 7 });
		expect(executeMock).toHaveBeenCalledWith(
			"INSERT INTO tanah_author (name, details) VALUES (?, ?)",
			["אבן עזרא", ""],
		);
	});

	it("throws when the created row cannot be read back", async () => {
		queryOneMock.mockResolvedValue(null);

		await expect(
			createAuthor({ data: { name: "אבן עזרא", details: "" } }),
		).rejects.toThrow("Failed to retrieve created author");
	});

	it("requires a name when updating", async () => {
		await expect(
			updateAuthor({ data: { id: 3, name: "", details: "x" } }),
		).rejects.toThrow("Name is required");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("updates and returns the author", async () => {
		queryOneMock.mockResolvedValue({ id: 3, name: 'רד"ק', details: "ד" });

		await expect(
			updateAuthor({ data: { id: 3, name: 'רד"ק', details: "ד" } }),
		).resolves.toMatchObject({ id: 3, name: 'רד"ק' });
		expect(executeMock).toHaveBeenCalledWith(
			"UPDATE tanah_author SET name = ?, details = ? WHERE id = ?",
			['רד"ק', "ד", 3],
		);
	});

	it("throws when the updated row cannot be read back", async () => {
		queryOneMock.mockResolvedValue(null);

		await expect(
			updateAuthor({ data: { id: 3, name: 'רד"ק', details: "" } }),
		).rejects.toThrow("Failed to retrieve updated author");
	});

	it("deletes an author", async () => {
		executeMock.mockResolvedValue({ affectedRows: 1 });

		await expect(deleteAuthor({ data: 4 })).resolves.toEqual({
			success: true,
		});
		expect(executeMock).toHaveBeenCalledWith(
			"DELETE FROM tanah_author WHERE id = ?",
			[4],
		);
	});
});

describe("author saves invalidate the website", () => {
	const ENV_KEYS = ["VITE_WEBSITE_URL", "REVALIDATE_SECRET"] as const;
	let savedEnv: Record<string, string | undefined>;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		process.env.VITE_WEBSITE_URL = "https://site.test";
		process.env.REVALIDATE_SECRET = "s3cr3t";
		fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
		fetchSpy.mockRestore();
	});

	it("expires authors and articles tags after a commit", async () => {
		queryOneMock.mockResolvedValue({ id: 3, name: 'רד"ק', details: "ד" });

		await updateAuthor({ data: { id: 3, name: 'רד"ק', details: "ד" } });

		const tags = fetchSpy.mock.calls.map((call: unknown[]) =>
			new URL(String(call[0])).searchParams.get("tag"),
		);
		expect(tags).toEqual(["authors", "articles"]);
	});
});
