import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("~/server/db", () => ({
	query: queryMock,
}));

import {
	pediaChangesForEntities,
	pediaChangesForEntryIds,
	pediaChangesForPersons,
} from "~/server/tanahpedia/paths";

/**
 * Entity/person/family mutations resolve typed entity changes carrying the
 * relationships a delete can no longer resolve afterwards — entry names,
 * entity types, synonyms and the perakim sourcing the entity. The website
 * unions them with what it can still resolve.
 */
describe("pedia change resolution", () => {
	beforeEach(() => {
		queryMock.mockReset().mockResolvedValue([]);
	});

	describe("pediaChangesForEntryIds", () => {
		it("emits one pedia-entry change per resolvable entry", async () => {
			queryMock
				// entry 1: unique_name + 3 relation queries
				.mockResolvedValueOnce([{ unique_name: "משה" }])
				.mockResolvedValueOnce([{ entity_type: "PERSON" }])
				.mockResolvedValueOnce([{ name: "משה רבנו" }])
				.mockResolvedValueOnce([{ perek_id: 12 }])
				// entry 2: unique_name + 3 relation queries
				.mockResolvedValueOnce([{ unique_name: "אהרן" }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const requests = await pediaChangesForEntryIds(["e1", "e2"]);

			expect(requests).toEqual([
				{
					changes: [
						{
							kind: "pedia-entry",
							uniqueName: "משה",
							entityTypes: ["PERSON"],
							synonymNames: ["משה רבנו"],
							refPerekIds: [12],
						},
						{
							kind: "pedia-entry",
							uniqueName: "אהרן",
							entityTypes: [],
							synonymNames: [],
							refPerekIds: [],
						},
					],
				},
			]);
		});

		it("skips entries that no longer exist", async () => {
			queryMock.mockResolvedValueOnce([]);

			await expect(pediaChangesForEntryIds(["gone"])).resolves.toEqual([]);
		});

		it("skips the lookup for an empty id list", async () => {
			await expect(pediaChangesForEntryIds([])).resolves.toEqual([]);
			expect(queryMock).not.toHaveBeenCalled();
		});
	});

	describe("pediaChangesForEntities", () => {
		it("carries type, linked entry names and source perakim", async () => {
			queryMock
				.mockResolvedValueOnce([{ id: "ent-1", entity_type: "PERSON" }])
				.mockResolvedValueOnce([
					{ entity_id: "ent-1", unique_name: "משה" },
					{ entity_id: "ent-1", unique_name: "משה" },
				])
				.mockResolvedValueOnce([
					{ entity_id: "ent-1", perek_id: 5 },
					{ entity_id: "ent-1", perek_id: 7 },
					{ entity_id: "ent-1", perek_id: 7 },
				]);

			const requests = await pediaChangesForEntities(["ent-1"]);

			expect(requests).toEqual([
				{
					changes: [
						{
							kind: "pedia-entity",
							entityId: "ent-1",
							entityType: "PERSON",
							entryUniqueNames: ["משה"],
							refPerekIds: [5, 7],
						},
					],
				},
			]);
		});

		it("skips the lookup for an empty id list", async () => {
			await expect(pediaChangesForEntities([])).resolves.toEqual([]);
			expect(queryMock).not.toHaveBeenCalled();
		});
	});

	describe("pediaChangesForPersons", () => {
		it("resolves persons to entities, then emits entity changes", async () => {
			queryMock
				.mockResolvedValueOnce([{ entity_id: "ent-1" }])
				.mockResolvedValueOnce([{ id: "ent-1", entity_type: "PERSON" }])
				.mockResolvedValueOnce([{ entity_id: "ent-1", unique_name: "יעקב" }])
				.mockResolvedValueOnce([]);

			const requests = await pediaChangesForPersons(["p-1"]);

			expect(String(queryMock.mock.calls[0]?.[0])).toContain(
				"FROM tanahpedia_person",
			);
			expect(requests).toEqual([
				{
					changes: [
						{
							kind: "pedia-entity",
							entityId: "ent-1",
							entityType: "PERSON",
							entryUniqueNames: ["יעקב"],
							refPerekIds: [],
						},
					],
				},
			]);
		});

		it("returns no changes when the persons own no entities", async () => {
			queryMock.mockResolvedValueOnce([]);

			await expect(pediaChangesForPersons(["p-1"])).resolves.toEqual([]);
			// The entity lookup short-circuits — no further queries issued.
			expect(queryMock).toHaveBeenCalledTimes(1);
		});
	});
});
