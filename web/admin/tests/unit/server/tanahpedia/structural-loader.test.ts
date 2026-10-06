import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, queryOneMock } = vi.hoisted(() => ({
	queryMock: vi.fn(),
	queryOneMock: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));

vi.mock("~/server/db", () => ({
	query: queryMock,
	queryOne: queryOneMock,
}));

import { loadEntryStructuralContext } from "~/server/tanahpedia/structural-loader.server";

const LINK_QUERY = /tanahpedia_entry_entity/;

function linkRow(entityType: string, entityId = "e1", linkId = "l1") {
	return { linkId, entityId, entityType, displayName: `name-${entityId}` };
}

describe("loadEntryStructuralContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns an empty list when the entry has no links", async () => {
		queryMock.mockResolvedValue([]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx).toEqual({ entryId: "entry-1", linkedEntities: [] });
		expect(queryMock).toHaveBeenCalledWith(expect.stringMatching(LINK_QUERY), [
			"entry-1",
		]);
	});

	it("skips linked entities whose type is not admin-creatable", async () => {
		queryMock.mockResolvedValue([linkRow("LOCATION")]);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities).toEqual([]);
	});

	it("loads person details with main name and sex", async () => {
		queryMock.mockResolvedValue([linkRow("PERSON")]);
		queryOneMock
			.mockResolvedValueOnce({ id: "p1" }) // tanahpedia_person
			.mockResolvedValueOnce({ id: "n1", name: "אברהם" }) // main name
			.mockResolvedValueOnce({ id: "s1", sex: "MALE" }); // sex row
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].person).toEqual({
			personId: "p1",
			mainName: "אברהם",
			mainNameRowId: "n1",
			sex: "MALE",
			sexRowId: "s1",
		});
	});

	it("leaves person undefined when there is no person row", async () => {
		queryMock.mockResolvedValue([linkRow("PERSON")]);
		queryOneMock.mockResolvedValue(null);
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].person).toBeUndefined();
	});

	it("loads place identifications and coerces numeric coordinates", async () => {
		queryMock.mockResolvedValueOnce([linkRow("PLACE")]).mockResolvedValueOnce([
			{ id: "i1", modern_name: "ירושלים", latitude: "31.7", longitude: 35.2 },
			{ id: "i2", modern_name: null, latitude: "bad", longitude: null },
		]);
		queryOneMock.mockResolvedValueOnce({ id: "pl1" });
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].place).toEqual({
			placeId: "pl1",
			identifications: [
				{ id: "i1", modern_name: "ירושלים", latitude: 31.7, longitude: 35.2 },
				{ id: "i2", modern_name: null, latitude: null, longitude: null },
			],
		});
	});

	it("loads the saying date for SAYING entities", async () => {
		queryMock.mockResolvedValue([linkRow("SAYING")]);
		queryOneMock.mockResolvedValueOnce({ id: "sy1", saying_date: -500 });
		const ctx = await loadEntryStructuralContext("entry-1");
		expect(ctx.linkedEntities[0].saying).toEqual({
			sayingId: "sy1",
			sayingDate: -500,
		});
	});
});
