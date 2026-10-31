/** @jest-environment node */
jest.mock("../../../src/lib/api-client", () => ({ query: jest.fn() }));

import { query } from "../../../src/lib/api-client";
import {
	getEntityReferencesForPereks,
	getMentionReferencesForPereks,
	type PerekScopedEntityReference,
} from "../../../src/lib/tanahpedia/service";

const mockQuery = jest.mocked(query);
const reference: PerekScopedEntityReference = {
	perekId: 12,
	entityId: "entry-moses",
	entityName: "Moses",
	entityType: "PERSON",
	entryUniqueName: "moses",
	pasukNumber: 1,
	segmentStart: 0,
	segmentEnd: 2,
};

beforeEach(() => {
	mockQuery.mockReset();
	jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe.each([
	["entity", getEntityReferencesForPereks, "ets"],
	["mention", getMentionReferencesForPereks, "d"],
] as const)("bulk %s references", (family, load, alias) => {
	it("does not query an empty chapter set", async () => {
		expect(await load([])).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it("binds exactly the requested sparse IDs and preserves chapter association", async () => {
		const ids = [927, 12, 927];
		const rows = [
			reference,
			{
				...reference,
				perekId: 927,
				entityId: "entry-aaron",
				entryUniqueName: null,
				segmentStart: null,
				segmentEnd: null,
			},
		];
		mockQuery.mockResolvedValueOnce(rows);

		expect(await load(ids)).toEqual(rows);
		expect(ids).toEqual([927, 12, 927]);
		expect(mockQuery).toHaveBeenCalledTimes(1);
		const [sql, params] = mockQuery.mock.calls[0];
		expect(params).toEqual(["927", "12", "927"]);
		expect(sql).toContain(`${alias}.perek_id IN (?, ?, ?)`);
		expect(sql).toContain(`${alias}.perek_id AS perekId`);
	});

	it("supports a single chapter through the same scoped API", async () => {
		mockQuery.mockResolvedValueOnce([reference]);
		expect(await load([12])).toEqual([reference]);
		expect(mockQuery.mock.calls[0][0]).toContain(`${alias}.perek_id IN (?)`);
		expect(mockQuery.mock.calls[0][1]).toEqual(["12"]);
	});

	it.each([
		{ code: "ER_NO_SUCH_TABLE" },
		{ errno: 1054 },
		new Error("connection reset"),
		"raw rejection",
	])(
		"rethrows %p unchanged so the cache cannot store a false empty",
		async (error) => {
			mockQuery.mockRejectedValueOnce(error);
			await expect(load([12, 927])).rejects.toBe(error);
			expect(console.error).toHaveBeenCalledWith(
				`Failed to fetch ${family} references for pereks 12, 927:`,
				error instanceof Error ? error.message : error,
			);
		},
	);
});

it("keeps curated entity joins and each chapter's verse/segment ordering", async () => {
	mockQuery.mockResolvedValueOnce([]);
	await getEntityReferencesForPereks([12, 927]);
	const [sql] = mockQuery.mock.calls[0];
	expect(sql).toContain(
		"LEFT JOIN tanahpedia_entry_entity ee ON ee.entity_id = e.id",
	);
	expect(sql).toContain(
		"LEFT JOIN tanahpedia_entry ent ON ent.id = ee.entry_id",
	);
	expect(sql).toMatch(
		/ORDER BY ets\.perek_id,\s*ets\.pasuk_number, ets\.segment_start/,
	);
});

it("keeps live synonym resolution, row ambiguity isolation, and manual precedence", async () => {
	mockQuery.mockResolvedValueOnce([]);
	await getMentionReferencesForPereks([12, 927]);
	const [sql] = mockQuery.mock.calls[0];
	expect(sql).toContain("ANY_VALUE(ent.id) AS entityId");
	expect(sql).toContain("ANY_VALUE(ent.title) AS entityName");
	expect(sql).toContain("ANY_VALUE(ent.unique_name) AS entryUniqueName");
	expect(sql).toContain("UNION ALL");
	expect(sql).toContain("tanahpedia_entry_synonym");
	expect(sql).toContain(
		"REPLACE(names.resolvedName, '-', ' ') = d.intended_name",
	);
	expect(sql).toContain("d.source_kind = 'pasuk'");
	expect(sql).toContain("d.acceptance IN ('auto', 'manual')");
	expect(sql).toContain("GROUP BY d.id");
	expect(sql).toContain("HAVING COUNT(DISTINCT names.entryId) <= 1");
	expect(sql).toMatch(
		/ORDER BY d\.perek_id,\s*pasukNumber, segmentStart, \(d\.acceptance = 'manual'\) DESC/,
	);
});
