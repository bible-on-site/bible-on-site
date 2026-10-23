jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import { buildEntityRefLookup } from "../../../src/lib/tanahpedia/entity-ref-lookup";
import {
	getMentionReferencesForPerek,
	type PerekEntityReference,
} from "../../../src/lib/tanahpedia/service";

const mockQuery = query as jest.MockedFunction<typeof query>;

describe("getMentionReferencesForPerek", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("queries published decorations for the perek only", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await getMentionReferencesForPerek(12);
		const [sql, params] = mockQuery.mock.calls[0];
		expect(params).toEqual(["12"]);
		expect(sql).toContain("tanahpedia_mention_decoration");
		expect(sql).toContain("d.source_kind = 'pasuk'");
		expect(sql).toContain("d.perek_id = ?");
		// Only pipeline-accepted or human-accepted decorations resolve.
		expect(sql).toContain("d.acceptance IN ('auto', 'manual')");
	});

	it("resolves intended names against unique names AND synonyms", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await getMentionReferencesForPerek(5);
		const [sql] = mockQuery.mock.calls[0];
		expect(sql).toContain("tanahpedia_entry e");
		expect(sql).toContain("tanahpedia_entry_synonym");
		// Name matching normalizes the entry-side hyphens to the pipeline's
		// space-separated intended_name contract.
		expect(sql).toContain("REPLACE(names.resolvedName, '-', ' ')");
	});

	it("drops name collisions so ambiguous mentions stay plain text", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await getMentionReferencesForPerek(7);
		const [sql] = mockQuery.mock.calls[0];
		expect(sql).toContain("HAVING COUNT(DISTINCT names.entryId) <= 1");
	});

	it("returns decorations in the shared PerekEntityReference shape", async () => {
		const row: PerekEntityReference = {
			entityId: "entry-1",
			entityName: "אברהם",
			entityType: "PERSON",
			entryUniqueName: "אברהם-אבינו",
			pasukNumber: 1,
			segmentStart: 3,
			segmentEnd: 3,
		};
		mockQuery.mockResolvedValueOnce([row]);
		await expect(getMentionReferencesForPerek(12)).resolves.toEqual([row]);
	});

	it("returns [] instead of throwing when the decoration table is absent", async () => {
		const consoleError = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockQuery.mockRejectedValueOnce(new Error("table doesn't exist"));
		await expect(getMentionReferencesForPerek(12)).resolves.toEqual([]);
		consoleError.mockRestore();
	});
});

describe("mention lifecycle without re-inference", () => {
	const unresolvedDecoration: PerekEntityReference = {
		entityId: "",
		entityName: "",
		entityType: "PERSON",
		entryUniqueName: null,
		pasukNumber: 1,
		segmentStart: 3,
		segmentEnd: 3,
	};

	it("unresolved decorations never reach the render lookup", () => {
		const lookup = buildEntityRefLookup([unresolvedDecoration]);
		expect(lookup.get(1) ?? []).toEqual([]);
	});

	it("entry creation flips the same span to linked with no span change", () => {
		const resolved = {
			...unresolvedDecoration,
			entityId: "entry-1",
			entryUniqueName: "אברהם-אבינו",
		};
		const lookup = buildEntityRefLookup([resolved]);
		const refs = lookup.get(1) ?? [];
		expect(refs).toHaveLength(1);
		expect(refs[0].entryUniqueName).toBe("אברהם-אבינו");
		expect(refs[0].segmentStart).toBe(3);
		expect(refs[0].segmentEnd).toBe(3);
	});
});
