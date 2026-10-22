import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("~/server/db", () => ({
	query: queryMock,
}));

import {
	pediaInvalidationForEntities,
	pediaInvalidationForEntryIds,
	pediaInvalidationForPersons,
	pediaPathsForEntities,
	pediaPathsForEntryIds,
	pediaPathsForPersons,
} from "~/server/tanahpedia/paths";

/**
 * Entity/person/family mutations resolve the public entry pages they touch
 * so the revalidation call can name the exact changed URLs for IndexNow.
 * The queries must run before deletes: once the link rows are gone the
 * affected pages can no longer be enumerated.
 */
describe("pedia path resolution", () => {
	beforeEach(() => {
		queryMock.mockReset().mockResolvedValue([]);
	});

	describe("pediaPathsForEntryIds", () => {
		it("maps entry ids to their public paths", async () => {
			queryMock.mockResolvedValue([
				{ unique_name: "משה" },
				{ unique_name: "אהרן" },
			]);

			await expect(pediaPathsForEntryIds(["e1", "e2"])).resolves.toEqual([
				"/pedia/משה",
				"/pedia/אהרן",
			]);
			expect(queryMock).toHaveBeenCalledWith(
				expect.stringContaining("FROM tanahpedia_entry"),
				["e1", "e2"],
			);
		});

		it("skips the lookup for an empty id list", async () => {
			await expect(pediaPathsForEntryIds([])).resolves.toEqual([]);
			expect(queryMock).not.toHaveBeenCalled();
		});
	});

	describe("pediaPathsForEntities", () => {
		it("joins through the entry_entity links", async () => {
			queryMock.mockResolvedValue([{ unique_name: "משה" }]);

			await expect(pediaPathsForEntities(["ent-1"])).resolves.toEqual([
				"/pedia/משה",
			]);
			const [sql, params] = queryMock.mock.calls[0] ?? [];
			expect(String(sql)).toContain("JOIN tanahpedia_entry_entity");
			expect(params).toEqual(["ent-1"]);
		});

		it("skips the lookup for an empty id list", async () => {
			await expect(pediaPathsForEntities([])).resolves.toEqual([]);
			expect(queryMock).not.toHaveBeenCalled();
		});
	});

	describe("pediaPathsForPersons", () => {
		it("resolves persons to entities, then to linked entries", async () => {
			queryMock
				.mockResolvedValueOnce([{ entity_id: "ent-1" }])
				.mockResolvedValueOnce([{ unique_name: "משה" }]);

			await expect(pediaPathsForPersons(["p-1"])).resolves.toEqual([
				"/pedia/משה",
			]);
			expect(queryMock).toHaveBeenCalledTimes(2);
			expect(String(queryMock.mock.calls[0]?.[0])).toContain(
				"FROM tanahpedia_person",
			);
		});

		it("returns no paths when the persons own no entities", async () => {
			queryMock.mockResolvedValueOnce([]);

			await expect(pediaPathsForPersons(["p-1"])).resolves.toEqual([]);
			// The entity lookup short-circuits — no entry query is issued.
			expect(queryMock).toHaveBeenCalledTimes(1);
		});
	});

	describe("invalidation batches", () => {
		it("carries the resolved urls on the pedia index request", async () => {
			queryMock.mockResolvedValue([{ unique_name: "משה" }]);

			const requests = await pediaInvalidationForEntities(["ent-1"]);

			expect(requests).toEqual([
				{ tag: "tanahpedia-entity-refs" },
				{ path: "/pedia/[slug]", type: "page" },
				{ path: "/pedia", urls: ["/pedia/משה"] },
			]);
		});

		it("keeps the base shape when nothing resolves", async () => {
			const requests = await pediaInvalidationForPersons(["p-1"]);

			expect(requests).toEqual([
				{ tag: "tanahpedia-entity-refs" },
				{ path: "/pedia/[slug]", type: "page" },
				{ path: "/pedia" },
			]);
		});

		it("resolves entry ids for link mutations", async () => {
			queryMock.mockResolvedValue([{ unique_name: "אהרן" }]);

			const requests = await pediaInvalidationForEntryIds(["e-9"]);

			expect(requests[2]).toEqual({
				path: "/pedia",
				urls: ["/pedia/אהרן"],
			});
		});
	});
});
