import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ChangeInput,
	ReviewedChange,
} from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({
	one: vi.fn(),
	query: vi.fn(),
	execute: vi.fn(),
	valid: vi.fn(),
	metrics: vi.fn(),
}));
vi.mock("~/server/db", () => ({
	txQueryOne: mocks.one,
	txQuery: mocks.query,
	txExecute: mocks.execute,
}));
vi.mock("~/server/tanahpedia/revisions", () => ({
	assertEntryFieldsValid: mocks.valid,
}));
vi.mock("~/server/reading-metrics", () => ({
	recomputeEntryMetrics: mocks.metrics,
}));

import {
	applyChange,
	contributionCatalogue,
	prepareChanges,
	readChangeState,
} from "~/server/tanahpedia/contribution-changes.server";

const ID = "00000000-0000-4000-8000-000000000001",
	OTHER = "00000000-0000-4000-8000-000000000002";
const conn = {} as never;
const parent = {
	parentId: ID,
	childId: OTHER,
	relationshipType: "BIOLOGICAL",
	parentRole: "FATHER",
	sourceCitation: "מקור",
	birthOrder: 2,
	altGroupId: null,
};
function reviewed(
	kind: ReviewedChange["kind"],
	after: ReviewedChange["after"],
	before: ReviewedChange["before"] = null,
): ReviewedChange {
	return { kind, targetId: ID, before, after, labels: {} };
}

describe("typed contribution domain API", () => {
	it.each([
		["WAR", "tanahpedia_event", "tanahpedia_war", "event_id"],
		["TEMPLE_TOOL", "tanahpedia_object", "tanahpedia_temple_tool", "object_id"],
		["PROPHECY", "tanahpedia_saying", "tanahpedia_prophecy", "saying_id"],
	])(
		"creates the required parent subtype for %s entries",
		async (entityType, parentTable, table, parentKey) => {
			await applyChange(
				conn,
				reviewed("entry", {
					title: "Title",
					uniqueName: "name",
					entityType,
					displayName: "Name",
				}),
				"pr:1",
			);
			expect(mocks.execute.mock.calls[3][1]).toContain(parentTable);
			expect(mocks.execute.mock.calls[4][1]).toContain(
				`${table} (id, ${parentKey}, entity_id)`,
			);
			expect(mocks.execute.mock.calls[4][2][1]).toBe(
				mocks.execute.mock.calls[3][2][0],
			);
			expect(mocks.execute.mock.calls[4][2][2]).toBe(
				mocks.execute.mock.calls[3][2][1],
			);
		},
	);
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
		mocks.one.mockResolvedValue({ id: OTHER, name: "Name" });
		mocks.query.mockResolvedValue([]);
		mocks.execute.mockResolvedValue({ affectedRows: 1 });
	});
	it("reads a locked target and normalizes decimal coordinates", async () => {
		mocks.one.mockResolvedValue({
			placeId: ID,
			modernName: null,
			latitude: "31.12345678",
			longitude: "35.12345678",
		});
		expect(await readChangeState(conn, "place", ID)).toMatchObject({
			latitude: 31.12345678,
			longitude: 35.12345678,
		});
		expect(mocks.one.mock.calls[0][1]).toContain("FOR UPDATE");
		mocks.one.mockResolvedValue({ latitude: null, longitude: null });
		expect(await readChangeState(conn, "place", ID)).toEqual({
			latitude: null,
			longitude: null,
		});
	});
	it("keeps absent targets absent", async () => {
		mocks.one.mockResolvedValue(null);
		expect(await readChangeState(conn, "metadata", ID)).toBeNull();
	});
	it("captures before state and resolves both sides of a relationship diff", async () => {
		mocks.one
			.mockResolvedValueOnce({ ...parent, birthOrder: 1 })
			.mockResolvedValue({ name: "Resolved" });
		const changes = await prepareChanges(conn, [
			{ kind: "parent_child", targetId: ID, after: parent } as ChangeInput,
		]);
		expect(changes[0]).toMatchObject({
			targetId: ID,
			before: { birthOrder: 1 },
			after: { birthOrder: 2 },
			labels: { [ID]: "Resolved", [OTHER]: "Resolved" },
		});
	});
	it("allocates a stable ID for a new row", async () => {
		mocks.one.mockResolvedValueOnce(null).mockResolvedValue({ name: "Person" });
		const changes = await prepareChanges(conn, [
			{ kind: "parent_child", after: parent } as ChangeInput,
		]);
		expect(changes[0].targetId).toMatch(/^[0-9a-f-]{36}$/);
		expect(changes[0].before).toBeNull();
	});
	it("rejects missing references and no-op proposals", async () => {
		mocks.one.mockResolvedValueOnce(null).mockResolvedValue(null);
		await expect(
			prepareChanges(conn, [
				{ kind: "parent_child", after: parent } as ChangeInput,
			]),
		).rejects.toThrow("does not exist");
		mocks.one.mockResolvedValue({ displayName: "Name" });
		await expect(
			prepareChanges(conn, [
				{ kind: "metadata", targetId: ID, after: { displayName: "Name" } },
			]),
		).rejects.toThrow("does not change");
	});
	it("rejects missing metadata targets and absent deletions", async () => {
		mocks.one.mockResolvedValue(null);
		await expect(
			prepareChanges(conn, [
				{ kind: "metadata", targetId: ID, after: { displayName: "Name" } },
			]),
		).rejects.toThrow("Entity not found");
		await expect(
			prepareChanges(conn, [{ kind: "place", targetId: ID, after: null }]),
		).rejects.toThrow("does not exist");
	});
	it("validates new entry paths and refuses existing entry targets", async () => {
		const input: ChangeInput = {
			kind: "entry",
			targetId: ID,
			after: {
				title: "Title",
				uniqueName: "name",
				entityType: "PERSON",
				displayName: "Name",
			},
		};
		await expect(prepareChanges(conn, [input])).rejects.toThrow(
			"already exists",
		);
		mocks.one.mockResolvedValue(null);
		await prepareChanges(conn, [input]);
		expect(mocks.valid).toHaveBeenCalledWith({
			title: "Title",
			unique_name: "name",
		});
	});
	it.each(["parent_child", "union", "place"] as const)(
		"deletes exactly one %s target",
		async (kind) => {
			await applyChange(
				conn,
				reviewed(kind, null, { field: "before" }),
				"source",
			);
			expect(mocks.execute.mock.calls[0][1]).toMatch(
				/^DELETE FROM tanahpedia_/,
			);
			expect(mocks.execute.mock.calls[0][2]).toEqual([ID]);
		},
	);
	it("updates entity metadata without writing entry prose", async () => {
		await applyChange(
			conn,
			reviewed("metadata", { displayName: "New" }, { displayName: "Old" }),
			"source",
		);
		expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
			conn,
			"UPDATE tanahpedia_entity SET name = ? WHERE id = ?",
			["New", ID],
		);
	});
	it("upserts a place identification including nullable alternate metadata", async () => {
		await applyChange(
			conn,
			reviewed("place", {
				placeId: OTHER,
				modernName: "City",
				latitude: 31.5,
				longitude: 35.2,
				altGroupId: null,
			}),
			"source",
		);
		expect(mocks.execute.mock.calls[0][2]).toEqual([
			ID,
			OTHER,
			"City",
			31.5,
			35.2,
			null,
		]);
	});
	it("applies all parent-child fields using resolved lookups", async () => {
		await applyChange(conn, reviewed("parent_child", parent), "source");
		expect(mocks.execute.mock.calls[0][2]).toEqual([
			ID,
			ID,
			OTHER,
			OTHER,
			OTHER,
			"מקור",
			null,
			2,
		]);
	});
	it("reports missing lookup rows rather than applying partial data", async () => {
		mocks.one.mockImplementation(async (_conn, sql) =>
			sql.includes("lookup") ? null : { name: "Person" },
		);
		await expect(
			applyChange(conn, reviewed("parent_child", parent), "source"),
		).rejects.toThrow("Missing lookup");
		expect(mocks.execute).not.toHaveBeenCalled();
	});
	it.each([null, "DEATH"])(
		"preserves all union metadata with end reason %s",
		async (endReason) => {
			await applyChange(
				conn,
				reviewed("union", {
					person1Id: ID,
					person2Id: OTHER,
					unionType: "MARRIAGE",
					unionOrder: 1,
					startDate: 100101,
					endDate: 100201,
					endReason,
					sourceCitation: "one",
					personSourceCitation: "two",
					altGroupId: null,
				}),
				"source",
			);
			expect(mocks.execute.mock.calls[0][2]).toEqual([
				ID,
				ID,
				OTHER,
				OTHER,
				1,
				100101,
				100201,
				endReason ? OTHER : null,
				"one",
				"two",
				null,
			]);
		},
	);
	it.each([
		"PERSON",
		"PLACE",
		"EVENT",
		"ANIMAL",
		"OBJECT",
		"PLANT",
		"ASTRONOMICAL_OBJECT",
		"SAYING",
		"SEFER",
		"NATION",
	])("creates an audited metadata-only %s entry", async (entityType) => {
		await applyChange(
			conn,
			reviewed("entry", {
				title: "Title",
				uniqueName: "name",
				entityType,
				displayName: "Name",
			}),
			"pr:1",
		);
		expect(mocks.valid).toHaveBeenCalled();
		expect(mocks.execute.mock.calls[0][1]).toContain("'<p></p>'");
		expect(mocks.execute.mock.calls[1][1]).toContain("'APPLIED'");
		expect(mocks.execute.mock.calls[1][2]).toContain("pr:1");
		expect(mocks.metrics).toHaveBeenCalledWith(conn, ID, "<p></p>");
		expect(
			mocks.execute.mock.calls.some((call) => call[1].includes("person_name")),
		).toBe(entityType === "PERSON");
	});
	it("builds a batched catalogue of named existing targets", async () => {
		mocks.query.mockImplementation(async (_conn, sql) =>
			sql.includes("FROM tanahpedia_person_parent_child")
				? [{ id: ID, label: "Parent → Child", ...parent }]
				: sql.includes("FROM tanahpedia_person_union")
					? [{ id: OTHER, label: "A ↔ B", person1Id: ID, person2Id: OTHER }]
					: sql.includes("FROM tanahpedia_place_identification")
						? [
								{
									id: "place",
									label: "City",
									placeId: ID,
									latitude: "31.5",
									longitude: "35.2",
								},
							]
						: [],
		);
		const result = await contributionCatalogue(conn);
		expect(result.targets).toHaveLength(3);
		expect(result.targets[2].after).toMatchObject({
			latitude: 31.5,
			longitude: 35.2,
		});
		expect(mocks.query).toHaveBeenCalledTimes(6);
	});
});
