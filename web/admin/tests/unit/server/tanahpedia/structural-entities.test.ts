import { beforeEach, describe, expect, it, vi } from "vitest";

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
		handler: (fn: () => unknown) => () => fn(),
	}),
}));

vi.mock("~/server/db", () => ({
	execute: executeMock,
	query: queryMock,
	queryOne: queryOneMock,
}));

import {
	createEntityAndLinkToEntry,
	linkExistingEntityToEntry,
	searchEntities,
} from "~/server/tanahpedia/structural";

/** Tables touched by the inserts, in order. */
function insertedTables(): string[] {
	return executeMock.mock.calls
		.map(([sql]) => /INSERT INTO\s+(\w+)/i.exec(String(sql))?.[1] ?? "")
		.filter(Boolean);
}

describe("createEntityAndLinkToEntry", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryOneMock.mockReset().mockResolvedValue({ id: "name-type-id" });
		queryMock.mockReset().mockResolvedValue([]);
	});

	describe("when the type has a plain subtype table", () => {
		it("creates the entity, its subtype row and the link", async () => {
			await createEntityAndLinkToEntry({
				data: { entryId: "entry-1", entityType: "ANIMAL", displayName: "אריה" },
			});

			expect(insertedTables()).toEqual([
				"tanahpedia_entity",
				"tanahpedia_animal",
				"tanahpedia_entry_entity",
			]);
		});

		it.each([
			["EVENT", "tanahpedia_event"],
			["OBJECT", "tanahpedia_object"],
			["PLANT", "tanahpedia_plant"],
			["ASTRONOMICAL_OBJECT", "tanahpedia_astronomical_object"],
			["SAYING", "tanahpedia_saying"],
			["SEFER", "tanahpedia_sefer"],
			["NATION", "tanahpedia_nation"],
			["PLACE", "tanahpedia_place"],
		])("supports %s", async (entityType, table) => {
			await createEntityAndLinkToEntry({
				data: {
					entryId: "entry-1",
					entityType: entityType as "EVENT",
					displayName: "שם",
				},
			});

			expect(insertedTables()).toContain(table);
		});
	});

	describe("when the type is a person", () => {
		it("also stores the main name", async () => {
			await createEntityAndLinkToEntry({
				data: { entryId: "entry-1", entityType: "PERSON", displayName: "משה" },
			});

			expect(insertedTables()).toEqual([
				"tanahpedia_entity",
				"tanahpedia_person",
				"tanahpedia_person_name",
				"tanahpedia_entry_entity",
			]);
		});
	});

	describe("when the type derives from another type", () => {
		it.each([
			["WAR", "tanahpedia_event", "tanahpedia_war"],
			["TEMPLE_TOOL", "tanahpedia_object", "tanahpedia_temple_tool"],
			["PROPHECY", "tanahpedia_saying", "tanahpedia_prophecy"],
		])("creates the parent row before the %s row", async (
			entityType,
			parentTable,
			table,
		) => {
			await createEntityAndLinkToEntry({
				data: {
					entryId: "entry-1",
					entityType: entityType as "WAR",
					displayName: "שם",
				},
			});

			expect(insertedTables()).toEqual([
				"tanahpedia_entity",
				parentTable,
				table,
				"tanahpedia_entry_entity",
			]);
		});

		it("points the derived row at the parent it just created", async () => {
			await createEntityAndLinkToEntry({
				data: { entryId: "entry-1", entityType: "WAR", displayName: "מלחמה" },
			});

			const parentId = executeMock.mock.calls[1]?.[1]?.[0];
			expect(executeMock.mock.calls[2]?.[1]?.[1]).toBe(parentId);
		});
	});

	describe("when the input is not usable", () => {
		it("rejects an unsupported type", async () => {
			await expect(
				createEntityAndLinkToEntry({
					data: {
						entryId: "entry-1",
						entityType: "TANAH_SEFER",
						displayName: "שם",
					},
				}),
			).rejects.toThrow("סוג יישות לא נתמך ליצירה");
		});

		it("rejects a blank name", async () => {
			await expect(
				createEntityAndLinkToEntry({
					data: { entryId: "entry-1", entityType: "PERSON", displayName: "  " },
				}),
			).rejects.toThrow("שם ריק");
		});
	});
});

describe("searchEntities", () => {
	beforeEach(() => {
		queryMock.mockReset().mockResolvedValue([]);
	});

	it("excludes entities already linked to the entry", async () => {
		await searchEntities({ data: { entryId: "entry-1", query: "מש" } });

		const [sql, params] = queryMock.mock.calls[0] ?? [];
		expect(String(sql)).toContain("NOT IN");
		expect(params).toEqual(["entry-1", "%מש%"]);
	});

	it("filters by entity type when one is given", async () => {
		await searchEntities({
			data: { entryId: "entry-1", query: "מש", entityType: "PERSON" },
		});

		const [sql, params] = queryMock.mock.calls[0] ?? [];
		expect(String(sql)).toContain("e.entity_type = ?");
		expect(params).toEqual(["entry-1", "%מש%", "PERSON"]);
	});

	it("returns the rows the database produced", async () => {
		queryMock.mockResolvedValue([
			{ entityId: "e1", entityType: "PERSON", name: "משה" },
		]);

		await expect(
			searchEntities({ data: { entryId: "entry-1", query: "מש" } }),
		).resolves.toEqual([{ entityId: "e1", entityType: "PERSON", name: "משה" }]);
	});
});

describe("linkExistingEntityToEntry", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryOneMock.mockReset();
	});

	describe("when the entity is not linked yet", () => {
		it("creates the link row", async () => {
			queryOneMock.mockResolvedValue(null);

			const result = await linkExistingEntityToEntry({
				data: { entryId: "entry-1", entityId: "entity-1" },
			});

			expect(insertedTables()).toEqual(["tanahpedia_entry_entity"]);
			expect(result.linkId).toEqual(expect.any(String));
		});
	});

	describe("when the entity is already linked", () => {
		it("reuses the existing link instead of duplicating it", async () => {
			queryOneMock.mockResolvedValue({ id: "existing-link" });

			await expect(
				linkExistingEntityToEntry({
					data: { entryId: "entry-1", entityId: "entity-1" },
				}),
			).resolves.toEqual({ linkId: "existing-link" });
			expect(executeMock).not.toHaveBeenCalled();
		});
	});
});
