import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
	queryMock: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));

vi.mock("~/server/db", () => ({
	query: queryMock,
}));

import { loadEntryStructuralContext } from "~/server/tanahpedia/structural-loader.server";

// Patterns are checked in order; \s after a table name keeps
// tanahpedia_person / tanahpedia_place from matching their _name/_sex/_identification children.
const LINKS_SQL = /tanahpedia_entry_entity/;
const PERSON_NAME_SQL = /tanahpedia_person_name/;
const PERSON_SEX_SQL = /tanahpedia_person_sex/;
const PERSON_SQL = /FROM tanahpedia_person\s/;
const PLACE_IDENT_SQL = /tanahpedia_place_identification/;
const PLACE_SQL = /FROM tanahpedia_place\s/;
const SAYING_SQL = /tanahpedia_saying/;

function linkRow(entityType: string, entityId = "e1", linkId = "l1") {
	return { linkId, entityId, entityType, displayName: `name-${entityId}` };
}

/** Dispatches query results by SQL shape, like the real batched lookups. */
function mockQueries(handlers: Array<[RegExp, unknown[]]>) {
	queryMock.mockImplementation((sql: unknown) => {
		const text = String(sql);
		for (const [pattern, rows] of handlers) {
			if (pattern.test(text)) return Promise.resolve(rows);
		}
		return Promise.resolve([]);
	});
}

describe("loadEntryStructuralContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns an empty list when the entry has no links", async () => {
		mockQueries([[LINKS_SQL, []]]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx).toEqual({ entryId: "entry-1", linkedEntities: [] });
		expect(queryMock).toHaveBeenCalledTimes(1);
		expect(queryMock).toHaveBeenCalledWith(expect.stringMatching(LINKS_SQL), [
			"entry-1",
		]);
	});

	it("skips linked entities whose type is not admin-creatable", async () => {
		mockQueries([[LINKS_SQL, [linkRow("LOCATION")]]]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities).toEqual([]);
		expect(queryMock).toHaveBeenCalledTimes(1);
	});

	it("loads person details with main name and sex", async () => {
		mockQueries([
			[LINKS_SQL, [linkRow("PERSON")]],
			[PERSON_SQL, [{ entity_id: "e1", id: "p1" }]],
			[PERSON_NAME_SQL, [{ person_id: "p1", id: "n1", name: "אברהם" }]],
			[PERSON_SEX_SQL, [{ person_id: "p1", id: "s1", sex: "MALE" }]],
		]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].person).toEqual({
			personId: "p1",
			mainName: "אברהם",
			mainNameRowId: "n1",
			sex: "MALE",
			sexRowId: "s1",
		});
		expect(queryMock).toHaveBeenCalledTimes(4);
	});

	it("batches several linked persons into one query per lookup", async () => {
		mockQueries([
			[
				LINKS_SQL,
				[
					linkRow("PERSON", "e1", "l1"),
					linkRow("PERSON", "e2", "l2"),
					linkRow("PERSON", "e3", "l3"),
				],
			],
			[
				PERSON_SQL,
				[
					{ entity_id: "e1", id: "p1" },
					{ entity_id: "e2", id: "p2" },
					{ entity_id: "e3", id: "p3" },
				],
			],
			[
				PERSON_NAME_SQL,
				[
					{ person_id: "p1", id: "n1", name: "אברהם" },
					{ person_id: "p3", id: "n3", name: "יצחק" },
				],
			],
			[
				PERSON_SEX_SQL,
				[
					{ person_id: "p1", id: "s1", sex: "MALE" },
					{ person_id: "p2", id: "s2", sex: "FEMALE" },
				],
			],
		]);
		const ctx = await loadEntryStructuralContext("entry-1");
		// links + persons + main names + sexes: no per-entity fan-out.
		expect(queryMock).toHaveBeenCalledTimes(4);
		expect(queryMock).toHaveBeenCalledWith(
			expect.stringContaining("entity_id IN (?, ?, ?)"),
			["e1", "e2", "e3"],
		);
		expect(ctx.linkedEntities.map((e) => e.person)).toEqual([
			{
				personId: "p1",
				mainName: "אברהם",
				mainNameRowId: "n1",
				sex: "MALE",
				sexRowId: "s1",
			},
			{
				personId: "p2",
				mainName: null,
				mainNameRowId: null,
				sex: "FEMALE",
				sexRowId: "s2",
			},
			{
				personId: "p3",
				mainName: "יצחק",
				mainNameRowId: "n3",
				sex: null,
				sexRowId: null,
			},
		]);
	});

	it("picks the first main name row per person when duplicates exist", async () => {
		mockQueries([
			[LINKS_SQL, [linkRow("PERSON")]],
			[PERSON_SQL, [{ entity_id: "e1", id: "p1" }]],
			[
				PERSON_NAME_SQL,
				[
					{ person_id: "p1", id: "n1", name: "אברהם" },
					{ person_id: "p1", id: "n2", name: "אברם" },
				],
			],
			[PERSON_SEX_SQL, []],
		]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].person?.mainNameRowId).toBe("n1");
	});

	it("leaves person undefined when there is no person row", async () => {
		mockQueries([
			[LINKS_SQL, [linkRow("PERSON")]],
			[PERSON_SQL, []],
		]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].person).toBeUndefined();
		expect(queryMock).toHaveBeenCalledTimes(2);
	});

	it("nulls person details when the name and sex rows are missing", async () => {
		mockQueries([
			[LINKS_SQL, [linkRow("PERSON")]],
			[PERSON_SQL, [{ entity_id: "e1", id: "p1" }]],
			[PERSON_NAME_SQL, []],
			[PERSON_SEX_SQL, []],
		]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].person).toEqual({
			personId: "p1",
			mainName: null,
			mainNameRowId: null,
			sex: null,
			sexRowId: null,
		});
	});

	it("leaves place undefined when there is no place row", async () => {
		mockQueries([
			[LINKS_SQL, [linkRow("PLACE")]],
			[PLACE_SQL, []],
		]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].place).toBeUndefined();
		expect(queryMock).toHaveBeenCalledTimes(2);
	});

	it("returns empty identifications when the place has none", async () => {
		mockQueries([
			[LINKS_SQL, [linkRow("PLACE")]],
			[PLACE_SQL, [{ entity_id: "e1", id: "pl1" }]],
			[PLACE_IDENT_SQL, []],
		]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].place).toEqual({
			placeId: "pl1",
			identifications: [],
		});
	});

	it("loads place identifications grouped per place and coerces coordinates", async () => {
		mockQueries([
			[LINKS_SQL, [linkRow("PLACE", "e1", "l1"), linkRow("PLACE", "e2", "l2")]],
			[
				PLACE_SQL,
				[
					{ entity_id: "e1", id: "pl1" },
					{ entity_id: "e2", id: "pl2" },
				],
			],
			[
				PLACE_IDENT_SQL,
				[
					{
						place_id: "pl1",
						id: "i1",
						modern_name: "ירושלים",
						latitude: "31.7",
						longitude: 35.2,
					},
					{
						place_id: "pl1",
						id: "i2",
						modern_name: null,
						latitude: "bad",
						longitude: null,
					},
					{
						place_id: "pl2",
						id: "i3",
						modern_name: "באר שבע",
						latitude: 31.25,
						longitude: "34.79",
					},
				],
			],
		]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].place).toEqual({
			placeId: "pl1",
			identifications: [
				{ id: "i1", modern_name: "ירושלים", latitude: 31.7, longitude: 35.2 },
				{ id: "i2", modern_name: null, latitude: null, longitude: null },
			],
		});
		expect(ctx.linkedEntities[1].place).toEqual({
			placeId: "pl2",
			identifications: [
				{
					id: "i3",
					modern_name: "באר שבע",
					latitude: 31.25,
					longitude: 34.79,
				},
			],
		});
		expect(queryMock).toHaveBeenCalledTimes(3);
	});

	it("loads the saying date for SAYING and PROPHECY entities", async () => {
		mockQueries([
			[
				LINKS_SQL,
				[linkRow("SAYING", "e1", "l1"), linkRow("PROPHECY", "e2", "l2")],
			],
			[
				SAYING_SQL,
				[
					{ entity_id: "e1", id: "sy1", saying_date: -500 },
					{ entity_id: "e2", id: "sy2", saying_date: null },
				],
			],
		]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].saying).toEqual({
			sayingId: "sy1",
			sayingDate: -500,
		});
		expect(ctx.linkedEntities[1].saying).toEqual({
			sayingId: "sy2",
			sayingDate: null,
		});
		expect(queryMock).toHaveBeenCalledTimes(2);
	});

	it("leaves saying undefined when there is no saying row", async () => {
		mockQueries([
			[LINKS_SQL, [linkRow("SAYING")]],
			[SAYING_SQL, []],
		]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].saying).toBeUndefined();
	});

	it("loads a mixed entry with all types in batched queries", async () => {
		mockQueries([
			[
				LINKS_SQL,
				[
					linkRow("PERSON", "e1", "l1"),
					linkRow("PLACE", "e2", "l2"),
					linkRow("SAYING", "e3", "l3"),
					linkRow("EVENT", "e4", "l4"),
				],
			],
			[PERSON_SQL, [{ entity_id: "e1", id: "p1" }]],
			[PERSON_NAME_SQL, [{ person_id: "p1", id: "n1", name: "אברהם" }]],
			[PERSON_SEX_SQL, [{ person_id: "p1", id: "s1", sex: "MALE" }]],
			[PLACE_SQL, [{ entity_id: "e2", id: "pl1" }]],
			[PLACE_IDENT_SQL, []],
			[SAYING_SQL, [{ entity_id: "e3", id: "sy1", saying_date: 57800000 }]],
		]);
		const ctx = await loadEntryStructuralContext("entry-1");
		// links + persons + names + sexes + places + identifications + sayings.
		expect(queryMock).toHaveBeenCalledTimes(7);
		expect(ctx.linkedEntities).toHaveLength(4);
		expect(ctx.linkedEntities[3]).toEqual({
			linkId: "l4",
			entityId: "e4",
			entityType: "EVENT",
			displayName: "name-e4",
		});
	});
});
