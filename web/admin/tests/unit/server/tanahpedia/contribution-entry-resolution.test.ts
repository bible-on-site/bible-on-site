import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeInput } from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("~/server/db", () => ({ txQuery: mocks.query }));

import { resolveEntryCreations } from "~/server/tanahpedia/contribution-entry-resolution.server";

const ID = "aaaaaaaa-0000-4000-8000-000000000001",
	ENTITY = "bbbbbbbb-0000-4000-8000-000000000001",
	OTHER = "cccccccc-0000-4000-8000-000000000001";
const creation: ChangeInput = {
	kind: "entry",
	targetId: OTHER,
	after: {
		title: "שלם",
		uniqueName: "שלם",
		displayName: "שלם",
		entityType: "PLACE",
	},
};
let canonical: { id: string }[],
	aliases: { aliasId: string; id: string }[],
	choices: { id: string }[],
	entities: { id: string }[],
	existing: { id: string }[];
beforeEach(() => {
	vi.resetAllMocks();
	canonical = [];
	aliases = [];
	choices = [];
	existing = [];
	entities = [{ id: ENTITY }];
	mocks.query.mockImplementation(async (_conn, sql: string) => {
		if (sql.includes("unique_name=?")) return canonical;
		if (sql.includes("entry_synonym WHERE")) return aliases;
		if (sql.includes("entry_synonym_disambiguation")) return choices;
		if (sql.includes("JOIN tanahpedia_entity")) return entities;
		if (sql.includes("WHERE id=?")) return existing;
		throw new Error(`Unexpected SQL: ${sql}`);
	});
});
describe("pending entry creation resolution", () => {
	it("rewrites a newly aliased creation as metadata edits while preserving addresses and prose", async () => {
		aliases = [{ aliasId: OTHER, id: ID }];
		const original = structuredClone(creation);
		expect(await resolveEntryCreations({} as never, [creation])).toEqual([
			{ kind: "entry_title", targetId: ID, after: { title: "שלם" } },
			{ kind: "metadata", targetId: ENTITY, after: { displayName: "שלם" } },
		]);
		expect(creation).toEqual(original);
	});
	it("uses an existing canonical entry before shadowed aliases", async () => {
		canonical = [{ id: ID }];
		aliases = [{ aliasId: OTHER, id: OTHER }];
		expect(
			(await resolveEntryCreations({} as never, [creation]))[0].targetId,
		).toBe(ID);
	});
	it("retains a genuinely new address and operations unrelated to creation", async () => {
		expect(await resolveEntryCreations({} as never, [creation])).toEqual([
			creation,
		]);
		const other: ChangeInput[] = [
			{ kind: "metadata", targetId: ENTITY, after: { displayName: "Name" } },
		];
		expect(await resolveEntryCreations({} as never, other)).toBe(other);
	});
	it("blocks ambiguous legacy disambiguation destinations without choosing one", async () => {
		aliases = [{ aliasId: ENTITY, id: ID }];
		choices = [{ id: OTHER }];
		await expect(
			resolveEntryCreations({} as never, [creation]),
		).rejects.toThrow("ambiguous alias");
	});
	it("requires exactly one compatible entity and deduplicates identical stored IDs", async () => {
		canonical = [{ id: ID }];
		entities = [];
		await expect(
			resolveEntryCreations({} as never, [creation]),
		).rejects.toThrow("one PLACE entity");
		entities = [{ id: ENTITY }, { id: OTHER }];
		await expect(
			resolveEntryCreations({} as never, [creation]),
		).rejects.toThrow("one PLACE entity");
		entities = [{ id: ENTITY }, { id: ENTITY.toUpperCase() }];
		expect(await resolveEntryCreations({} as never, [creation])).toHaveLength(
			2,
		);
	});
	it("resolves an already-created target ID and refuses colliding rewritten operations", async () => {
		existing = [{ id: ID }];
		expect(
			(await resolveEntryCreations({} as never, [creation]))[0].targetId,
		).toBe(ID);
		await expect(
			resolveEntryCreations({} as never, [
				creation,
				{ ...creation, targetId: ENTITY },
			]),
		).rejects.toThrow("once");
	});
	it("retains an explicit reviewed alias removal plus replacement creation", async () => {
		aliases = [{ aliasId: ID, id: OTHER }];
		const inputs: ChangeInput[] = [
			creation,
			{ kind: "alias_mapping", targetId: ID.toUpperCase(), after: null },
		];
		expect(await resolveEntryCreations({} as never, inputs)).toEqual(inputs);
	});
});
