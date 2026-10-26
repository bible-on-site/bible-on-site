jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import { buildEntityRefLookup } from "../../../src/lib/tanahpedia/entity-ref-lookup";
import {
	type ArticleMentionReference,
	getMentionReferencesForArticle,
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

	it("wraps non-grouped entry columns so the query is only_full_group_by safe", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await getMentionReferencesForPerek(9);
		const [sql] = mockQuery.mock.calls[0];
		// GROUP BY d.id cannot prove functional dependence for ent.* (the join
		// goes through the derived names table); MySQL's default sql_mode
		// rejects bare ent columns. ANY_VALUE is deterministic here: kept
		// groups have at most one distinct entryId.
		expect(sql).toContain("ANY_VALUE(ent.id) AS entityId");
		expect(sql).toContain("ANY_VALUE(ent.title) AS entityName");
		expect(sql).not.toMatch(/SELECT\s+ent\.id/);
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

	it("rethrows when the decoration query fails — the cached wrapper decides degradation", async () => {
		const consoleError = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockQuery.mockRejectedValueOnce(new Error("table doesn't exist"));
		await expect(getMentionReferencesForPerek(12)).rejects.toThrow(
			"table doesn't exist",
		);
		consoleError.mockRestore();
	});

	it("logs non-Error rejections verbatim then rethrows", async () => {
		const consoleError = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockQuery.mockRejectedValueOnce("db gone");
		await expect(getMentionReferencesForPerek(12)).rejects.toBe("db gone");
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining("perek 12"),
			"db gone",
		);
		consoleError.mockRestore();
	});
});

describe("getMentionReferencesForArticle", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("queries published article decorations for the current content hash only", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await getMentionReferencesForArticle(42, "abc123");
		const [sql, params] = mockQuery.mock.calls[0];
		expect(params).toEqual(["42", "abc123"]);
		expect(sql).toContain("tanahpedia_mention_decoration");
		expect(sql).toContain("d.source_kind = 'article'");
		expect(sql).toContain("d.article_id = ?");
		// The content hash is the staleness key: edited articles resolve
		// nothing rather than misplacing anchors.
		expect(sql).toContain("d.content_hash = ?");
		expect(sql).toContain("d.acceptance IN ('auto', 'manual')");
	});

	it("resolves intended names against unique names AND synonyms", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await getMentionReferencesForArticle(1, "h");
		const [sql] = mockQuery.mock.calls[0];
		expect(sql).toContain("tanahpedia_entry e");
		expect(sql).toContain("tanahpedia_entry_synonym");
		expect(sql).toContain("REPLACE(names.resolvedName, '-', ' ')");
	});

	it("drops name collisions so ambiguous mentions stay plain text", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await getMentionReferencesForArticle(1, "h");
		const [sql] = mockQuery.mock.calls[0];
		expect(sql).toContain("HAVING COUNT(DISTINCT names.entryId) <= 1");
	});

	it("wraps non-grouped entry columns so the query is only_full_group_by safe", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await getMentionReferencesForArticle(1, "h");
		const [sql] = mockQuery.mock.calls[0];
		expect(sql).toContain("ANY_VALUE(ent.unique_name) AS entryUniqueName");
		expect(sql).not.toMatch(/SELECT\s+ent\./);
	});

	it("returns resolved refs in span order for the decorator", async () => {
		const row: ArticleMentionReference = {
			entryUniqueName: "אברהם-אבינו",
			spanStart: 40,
			spanEnd: 44,
			surface: "אברם",
		};
		mockQuery.mockResolvedValueOnce([row]);
		await expect(getMentionReferencesForArticle(42, "h")).resolves.toEqual([
			row,
		]);
	});

	it("returns [] instead of throwing when the decoration table is absent", async () => {
		const consoleError = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockQuery.mockRejectedValueOnce(new Error("table doesn't exist"));
		await expect(getMentionReferencesForArticle(42, "h")).resolves.toEqual([]);
		consoleError.mockRestore();
	});

	it("logs non-Error rejections verbatim", async () => {
		const consoleError = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockQuery.mockRejectedValueOnce("db gone");
		await expect(getMentionReferencesForArticle(42, "h")).resolves.toEqual([]);
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining("article 42"),
			"db gone",
		);
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
