import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, queryMock, queryOneMock } = vi.hoisted(() => ({
	executeMock: vi.fn(),
	queryMock: vi.fn(),
	queryOneMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		const chain = {
			inputValidator: () => chain,
			handler: (fn: unknown) => fn,
		};
		return chain;
	},
}));

vi.mock("../db", () => ({
	execute: executeMock,
	query: queryMock,
	queryOne: queryOneMock,
}));

import {
	createFamilyPersonNode,
	createParentChildLink,
	createUnionLink,
	getFamilyLookups,
} from "./family";

describe("tanahpedia family api", () => {
	beforeEach(() => {
		executeMock.mockReset();
		queryMock.mockReset();
		queryOneMock.mockReset();
	});

	it("creates person node with trimmed name and optional entry link", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "name-type-main" });
		executeMock.mockResolvedValue(undefined);

		const result = await createFamilyPersonNode({
			data: {
				displayName: "  Jacob  ",
				sex: "male" as unknown as "MALE",
				linkToEntryId: "entry-1",
			},
		});

		expect(result.entityId).toBeTruthy();
		expect(result.personId).toBeTruthy();
		expect(result.linkId).toBeTruthy();
		expect(executeMock).toHaveBeenCalledTimes(5);
		expect(executeMock.mock.calls[0]?.[1]).toEqual([
			result.entityId,
			"Jacob",
		]);
		expect(executeMock.mock.calls[3]?.[1]?.[2]).toBe("MALE");
	});

	it("rejects invalid person sex", async () => {
		await expect(
			createFamilyPersonNode({
				data: {
					displayName: "Jacob",
					sex: "other" as unknown as "MALE",
				},
			}),
		).rejects.toThrow("sex must be MALE, FEMALE, UNKNOWN, or null");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("creates parent-child link with lookup ids", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "rel-bio" })
			.mockResolvedValueOnce({ id: "role-father" });
		executeMock.mockResolvedValue(undefined);

		const result = await createParentChildLink({
			data: {
				parentPersonId: "parent-1",
				childPersonId: "child-1",
				relationshipType: "BIOLOGICAL",
				parentRole: "FATHER",
				sourceCitation: "Gen 25",
			},
		});

		expect(result.id).toBeTruthy();
		expect(queryOneMock).toHaveBeenCalledTimes(2);
		expect(executeMock).toHaveBeenCalledTimes(1);
		expect(executeMock.mock.calls[0]?.[1]).toEqual([
			result.id,
			"parent-1",
			"child-1",
			"rel-bio",
			"role-father",
			null,
			"Gen 25",
		]);
	});

	it("rejects invalid relationship type", async () => {
		await expect(
			createParentChildLink({
				data: {
					parentPersonId: "parent-1",
					childPersonId: "child-1",
					relationshipType: "INVALID" as unknown as "BIOLOGICAL",
					parentRole: "FATHER",
				},
			}),
		).rejects.toThrow("Invalid relationshipType");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("rejects union where both people are identical", async () => {
		await expect(
			createUnionLink({
				data: {
					person1Id: "same-person",
					person2Id: "same-person",
					unionType: "MARRIAGE",
				},
			}),
		).rejects.toThrow("person1Id and person2Id must be different");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("creates union link with end reason lookup", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "end-death" })
			.mockResolvedValueOnce({ id: "union-marriage" });
		executeMock.mockResolvedValue(undefined);

		const result = await createUnionLink({
			data: {
				person1Id: "p1",
				person2Id: "p2",
				unionType: "MARRIAGE",
				endReason: "DEATH",
				unionOrder: 2,
				sourceCitation: "Gen 29",
			},
		});

		expect(result.id).toBeTruthy();
		expect(executeMock).toHaveBeenCalledTimes(1);
		expect(executeMock.mock.calls[0]?.[1]).toEqual([
			result.id,
			"p1",
			"p2",
			"union-marriage",
			2,
			null,
			null,
			"end-death",
			null,
			"Gen 29",
		]);
	});

	it("returns lookup lists grouped by table", async () => {
		queryMock
			.mockResolvedValueOnce([{ id: "rt-1", name: "BIOLOGICAL" }])
			.mockResolvedValueOnce([{ id: "pr-1", name: "FATHER" }])
			.mockResolvedValueOnce([{ id: "ut-1", name: "MARRIAGE" }])
			.mockResolvedValueOnce([{ id: "er-1", name: "DEATH" }]);

		const lookups = await getFamilyLookups();

		expect(lookups).toEqual({
			relationshipTypes: [{ id: "rt-1", name: "BIOLOGICAL" }],
			parentRoles: [{ id: "pr-1", name: "FATHER" }],
			unionTypes: [{ id: "ut-1", name: "MARRIAGE" }],
			unionEndReasons: [{ id: "er-1", name: "DEATH" }],
		});
	});
});