jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import { buildEntityRefLookup } from "../../../src/lib/tanahpedia/entity-ref-lookup";
import {
	type ArticleMentionReference,
	getMentionReferencesForArticle,
	type PerekEntityReference,
} from "../../../src/lib/tanahpedia/service";

const mockQuery = query as jest.MockedFunction<typeof query>;

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
		expect(sql).toContain("e.normalized_name = d.intended_name");
		expect(sql).toContain("s.normalized_name = d.intended_name");
		expect(sql).not.toContain("REPLACE(");
	});

	it("drops name collisions so ambiguous mentions stay plain text", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await getMentionReferencesForArticle(1, "h");
		const [sql] = mockQuery.mock.calls[0];
		expect(sql).toContain("HAVING COUNT(DISTINCT m.entry_id) <= 1");
		expect(sql).toContain("COUNT(DISTINCT m2.entry_id)");
	});

	it("falls back to the pre-migration REPLACE() join while normalized_name is absent", async () => {
		const missingColumn = Object.assign(
			new Error("Unknown column 's.normalized_name' in 'on clause'"),
			{ code: "ER_BAD_FIELD_ERROR" },
		);
		mockQuery.mockRejectedValueOnce(missingColumn).mockResolvedValueOnce([]);
		await expect(getMentionReferencesForArticle(42, "h")).resolves.toEqual([]);
		expect(mockQuery).toHaveBeenCalledTimes(2);
		const [fallbackSql, fallbackParams] = mockQuery.mock.calls[1];
		expect(fallbackParams).toEqual(["42", "h"]);
		expect(fallbackSql).toContain(
			"REPLACE(names.resolvedName, '-', ' ') = d.intended_name",
		);
		expect(fallbackSql).toContain("HAVING COUNT(DISTINCT names.entryId) <= 1");
	});

	it("emits one row per decoration with bare entry columns", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await getMentionReferencesForArticle(1, "h");
		const [sql] = mockQuery.mock.calls[0];
		expect(sql).toContain("ent.unique_name AS entryUniqueName");
		expect(sql).not.toContain("GROUP BY");
		expect(sql).not.toContain("ANY_VALUE");
	});

	it("orders human-accepted rows ahead of pipeline rows sharing a span", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await getMentionReferencesForArticle(1, "h");
		const [sql] = mockQuery.mock.calls[0];
		expect(sql).toContain("(d.acceptance = 'manual') DESC");
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
