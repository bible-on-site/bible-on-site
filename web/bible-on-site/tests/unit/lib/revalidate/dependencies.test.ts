/**
 * @jest-environment node
 *
 * The dependency index is the correctness core of entity-scoped ISR: an
 * admin change must expire every route that renders the entity — its own
 * page, the hosting perek lists, the division units reached through
 * covering sources, and the destroyed side of renames/deletes — without
 * resorting to whole-site invalidation.
 */
jest.mock("../../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

// Closed fixture: parasha unit 1 covers perek 5 (torah) and perek 6
// (haftara); unit 2 has no auxiliary ranges; masora unit 1 covers perek 9.
// rangesPerekSlices is the identity here because the fixture ranges are
// already perek slices.
jest.mock("../../../../src/data/parasha/parasha-units", () => ({
	getAllParashaUnits: () => [
		{ unitId: 1, ranges: [{ perekId: 5, startPasuk: 1, endPasuk: 10 }] },
		{ unitId: 2, ranges: [{ perekId: 500, startPasuk: 1, endPasuk: 10 }] },
	],
	parashaAuxiliaryRanges: (unit: { unitId: number }) =>
		unit.unitId === 1 ? [{ perekId: 6, startPasuk: 1, endPasuk: 8 }] : [],
}));
jest.mock("../../../../src/data/masora/masora-units", () => ({
	getAllMasoraUnits: () => [
		{ unitId: 1, ranges: [{ perekId: 9, startPasuk: 1, endPasuk: 10 }] },
	],
}));
jest.mock("../../../../src/lib/reading/ranges", () => ({
	rangesPerekSlices: (ranges: unknown[]) => ranges,
}));
jest.mock("../../../../src/lib/reading/queries", () => ({
	canonicalPasukCount: () => 999,
}));
jest.mock("../../../../src/lib/authors", () => ({
	authorNameToSlug: (name: string) => `slug:${name}`,
	normalizeAuthorName: (name: string) => name.trim(),
}));

import { query } from "../../../../src/lib/api-client";
import { resolveEntityChanges } from "../../../../src/lib/revalidate/dependencies";

const mockQuery = query as jest.MockedFunction<typeof query>;

/** Dispatch the resolver's post-commit reads by SQL shape. */
function stubDb(handlers: {
	authorName?: string | null;
	authorArticles?: { id: number; perek_id: number }[];
	articleCovering?: { perek_id: number; pasuk: number }[];
	authorCovering?: { perek_id: number; pasuk: number }[];
	entryId?: string | null;
	entryEntityTypes?: string[];
	entrySynonyms?: string[];
	entryRefPereks?: number[];
	entityEntries?: string[];
	entityRefPereks?: number[];
	entityTypes?: string[];
	linkedSynonyms?: string[];
}) {
	mockQuery.mockImplementation(async (sql: string) => {
		if (/FROM tanah_author/.test(sql))
			return handlers.authorName ? [{ name: handlers.authorName }] : [];
		if (/covering_source cs/.test(sql)) return handlers.authorCovering ?? [];
		if (/FROM tanah_article_covering_source/.test(sql))
			return handlers.articleCovering ?? [];
		if (/FROM tanah_article\s/.test(sql)) return handlers.authorArticles ?? [];
		if (/FROM tanahpedia_entry e\s+JOIN tanahpedia_entry_entity/.test(sql))
			return (handlers.entityEntries ?? []).map((unique_name) => ({
				unique_name,
			}));
		if (/FROM tanahpedia_entry\s+WHERE unique_name/.test(sql))
			return handlers.entryId ? [{ id: handlers.entryId }] : [];
		if (/tanahpedia_entry_entity ee\s+JOIN tanahpedia_entity/.test(sql))
			return (handlers.entryEntityTypes ?? []).map((entity_type) => ({
				entity_type,
			}));
		if (/FROM tanahpedia_entry_synonym WHERE/.test(sql))
			return (handlers.entrySynonyms ?? []).map((name) => ({ name }));
		if (/tanahpedia_entity_tanah_source ets/.test(sql))
			return (handlers.entryRefPereks ?? []).map((perek_id) => ({
				perek_id,
			}));
		if (/FROM tanahpedia_entity_tanah_source/.test(sql))
			return (handlers.entityRefPereks ?? []).map((perek_id) => ({
				perek_id,
			}));
		if (/entity_type FROM tanahpedia_entity/.test(sql))
			return (handlers.entityTypes ?? []).map((entity_type) => ({
				entity_type,
			}));
		if (/FROM tanahpedia_entry_synonym s/.test(sql))
			return (handlers.linkedSynonyms ?? []).map((name) => ({ name }));
		throw new Error(`unstubbed SQL: ${sql}`);
	});
}

describe("resolveEntityChanges", () => {
	beforeEach(() => jest.clearAllMocks());

	it("resolves an article change to its page, perek, author and covering units", async () => {
		stubDb({
			authorName: "רשי",
			articleCovering: [{ perek_id: 9, pasuk: 3 }],
		});
		const out = await resolveEntityChanges([
			{
				kind: "article",
				id: 12,
				perekIds: [5, 7],
				authorIds: [3],
				coveringSpans: [{ perekId: 9, pasukFrom: 2, pasukTo: 4 }],
			},
		]);
		expect(out.tags).toEqual(
			expect.arrayContaining([
				"article:12",
				"perek:5:articles",
				"perek:7:articles",
				"author:3:articles",
				"author:רשי",
				"parasha:1:torah:articles",
				"masora:1:articles",
			]),
		);
		expect(out.paths).toEqual(
			expect.arrayContaining([
				"/929/5",
				"/929/5/12",
				"/929/7",
				"/929/7/12",
				"/929/authors/slug:רשי",
				"/parasha/1",
				"/masora/1",
			]),
		);
		expect(out.urls).toEqual(out.paths);
	});

	it("expires the articles collection for an unlocatable article", async () => {
		stubDb({});
		const out = await resolveEntityChanges([
			{ kind: "article", id: 99, perekIds: [] },
		]);
		expect(out.tags).toContain("articles");
		expect(out.tags).toContain("article:99");
	});

	it("propagates a transient DB error instead of under-invalidating", async () => {
		mockQuery.mockRejectedValueOnce(new Error("conn reset"));
		await expect(
			resolveEntityChanges([
				{ kind: "article", id: 12, perekIds: [5], authorIds: [3] },
			]),
		).rejects.toThrow("conn reset");
	});

	it("degrades article covering to primary-perek matching while the covering-source schema is absent", async () => {
		mockQuery.mockImplementation(async (sql: string) => {
			if (/covering_source/.test(sql))
				throw Object.assign(new Error("missing table"), {
					code: "ER_NO_SUCH_TABLE",
				});
			return [];
		});
		const out = await resolveEntityChanges([
			{ kind: "article", id: 7, perekIds: [5] },
		]);
		expect(out.tags).toEqual(
			expect.arrayContaining([
				"article:7",
				"perek:5:articles",
				"parasha:1:torah:articles",
			]),
		);
	});

	it("degrades the author covering lookup the same way", async () => {
		mockQuery.mockImplementation(async (sql: string) => {
			if (/covering_source cs/.test(sql))
				throw Object.assign(new Error("missing table"), {
					code: "ER_NO_SUCH_TABLE",
				});
			if (/FROM tanah_article\s/.test(sql)) return [{ id: 12, perek_id: 5 }];
			return [];
		});
		const out = await resolveEntityChanges([
			{ kind: "author", id: 3, name: "רשי" },
		]);
		expect(out.tags).toEqual(
			expect.arrayContaining([
				"author:רשי",
				"article:12",
				"perek:5:articles",
				"parasha:1:torah:articles",
			]),
		);
	});

	it("skips author page deps when the author row no longer exists", async () => {
		stubDb({ authorName: null });
		const out = await resolveEntityChanges([
			{ kind: "article", id: 1, perekIds: [5], authorIds: [9] },
		]);
		expect(out.tags).toContain("author:9:articles");
		expect(out.paths.some((p) => p.startsWith("/929/authors/"))).toBe(false);
	});

	it("resolves an author rename to old+new pages and every article surface", async () => {
		stubDb({
			authorArticles: [{ id: 12, perek_id: 5 }],
			authorCovering: [{ perek_id: 9, pasuk: 1 }],
		});
		const out = await resolveEntityChanges([
			{ kind: "author", id: 3, name: "רשי", oldName: "ישן" },
		]);
		expect(out.tags).toEqual(
			expect.arrayContaining([
				"authors",
				"author:רשי",
				"author:ישן",
				"author:3",
				"author:3:articles",
				"article:12",
				"perek:5:articles",
				"parasha:1:torah:articles",
				"masora:1:articles",
			]),
		);
		expect(out.paths).toEqual(
			expect.arrayContaining([
				"/929/authors",
				"/929/authors/slug:רשי",
				"/929/authors/slug:ישן",
				"/929/5",
				"/929/5/12",
				"/parasha/1",
				"/masora/1",
			]),
		);
	});

	it("resolves an author change carrying no previous name", async () => {
		stubDb({});
		const out = await resolveEntityChanges([
			{ kind: "author", id: 3, name: "רשי" },
		]);
		expect(out.tags).toEqual(
			expect.arrayContaining([
				"authors",
				"author:רשי",
				"author:3",
				"author:3:articles",
			]),
		);
	});

	it("resolves a live pedia entry including synonyms, old name and category", async () => {
		stubDb({
			entryId: "e1",
			entryEntityTypes: ["PERSON"],
			entrySynonyms: ["משה רבנו"],
			entryRefPereks: [12],
		});
		const out = await resolveEntityChanges([
			{
				kind: "pedia-entry",
				uniqueName: "משה",
				oldUniqueName: "ישן",
				entityTypes: ["PLACE"],
				synonymNames: ["מושה"],
				refPerekIds: [5],
			},
		]);
		expect(out.paths).toEqual(
			expect.arrayContaining([
				"/pedia/משה",
				"/pedia/ישן",
				"/pedia/משה רבנו",
				"/pedia/מושה",
				"/pedia",
				"/pedia/אישים",
				"/pedia/מקומות",
			]),
		);
		expect(out.tags).toEqual(
			expect.arrayContaining([
				"perek:12:entity-refs",
				"perek:5:entity-refs",
				"tanahpedia-mention-refs",
			]),
		);
	});

	it("resolves a deleted entry from the supplied old relationships", async () => {
		stubDb({ entryId: null });
		const out = await resolveEntityChanges([
			{
				kind: "pedia-entry",
				uniqueName: "נמחק",
				oldUniqueName: "ישן",
				entityTypes: ["PERSON"],
				synonymNames: ["כינוי"],
				refPerekIds: [9],
			},
		]);
		expect(out.paths).toEqual(
			expect.arrayContaining([
				"/pedia/נמחק",
				"/pedia/ישן",
				"/pedia/כינוי",
				"/pedia/אישים",
			]),
		);
		expect(out.tags).toContain("perek:9:entity-refs");
	});

	it("resolves a pedia-entry change carrying only its name", async () => {
		stubDb({ entryId: null });
		const out = await resolveEntityChanges([
			{ kind: "pedia-entry", uniqueName: "נמחק" },
		]);
		expect(out.paths).toEqual(
			expect.arrayContaining(["/pedia/נמחק", "/pedia"]),
		);
		expect(out.tags).toContain("tanahpedia-mention-refs");
	});

	it("resolves a pedia entity through its live links unioned with the event", async () => {
		stubDb({
			entityEntries: ["משה"],
			entityRefPereks: [12],
			entityTypes: ["PERSON"],
			linkedSynonyms: ["משה רבנו"],
		});
		const out = await resolveEntityChanges([
			{
				kind: "pedia-entity",
				entityId: "ent-1",
				entityType: "PLACE",
				entryUniqueNames: ["אהרן"],
				refPerekIds: [5],
			},
		]);
		expect(out.paths).toEqual(
			expect.arrayContaining([
				"/pedia/משה",
				"/pedia/אהרן",
				"/pedia/משה רבנו",
				"/pedia/אישים",
				"/pedia/מקומות",
			]),
		);
		expect(out.tags).toEqual(
			expect.arrayContaining(["perek:12:entity-refs", "perek:5:entity-refs"]),
		);
	});

	it("resolves a pedia-entity with no surviving entry links", async () => {
		stubDb({ entityEntries: [], entityRefPereks: [], entityTypes: [] });
		const out = await resolveEntityChanges([
			{ kind: "pedia-entity", entityId: "e-gone" },
		]);
		expect(out.paths).toContain("/pedia");
		expect(out.tags).toContain("tanahpedia-mention-refs");
	});

	it("resolves a bulk pedia-entries change without touching the DB", async () => {
		const out = await resolveEntityChanges([
			{
				kind: "pedia-entries",
				uniqueNames: ["א", "ב"],
				entityTypes: ["NATION"],
				refPerekIds: [5],
			},
		]);
		expect(mockQuery).not.toHaveBeenCalled();
		expect(out.paths).toEqual(
			expect.arrayContaining(["/pedia/א", "/pedia/ב", "/pedia/עמים"]),
		);
		expect(out.tags).toContain("perek:5:entity-refs");
	});

	it("coalesces repeated changes into one dependency set", async () => {
		stubDb({});
		const out = await resolveEntityChanges([
			{ kind: "article", id: 12, perekIds: [5] },
			{ kind: "article", id: 12, perekIds: [5] },
		]);
		expect(out.tags.filter((t) => t === "article:12")).toHaveLength(1);
	});

	it("falls back to collection-level invalidation on fan-out overflow", async () => {
		const uniqueNames = Array.from({ length: 2001 }, (_, i) => `e${i}`);
		const out = await resolveEntityChanges([
			{ kind: "pedia-entries", uniqueNames },
		]);
		expect(out.patterns).toEqual([{ path: "/pedia/[slug]", type: "page" }]);
		expect(out.tags).toEqual(
			expect.arrayContaining([
				"articles",
				"authors",
				"tanahpedia-entity-refs",
				"tanahpedia-mention-refs",
			]),
		);
		expect(out.paths).toEqual(
			expect.arrayContaining(["/pedia", "/929/authors"]),
		);
	});

	it("ignores an entity type with no category page", async () => {
		stubDb({ entryId: null });
		const out = await resolveEntityChanges([
			{
				kind: "pedia-entry",
				uniqueName: "x",
				entityTypes: ["NOT_A_CATEGORY"],
			},
		]);
		expect(out.paths).not.toContain("/pedia/undefined");
	});

	// --- dedication resolution (#2731) -------------------------------------
	it("bounds a maximum-size batch of overlapping canonical ranges to the affected corpus", async () => {
		stubDb({});
		const out = await resolveEntityChanges([
			{
				kind: "dedication",
				id: 7,
				perekRanges: Array.from({ length: 512 }, () => ({ low: 1, high: 929 })),
			},
		]);
		expect(out.tags).toHaveLength(929);
		expect(out.paths).toHaveLength(929);
		expect(out.paths).toEqual(expect.arrayContaining(["/929/1", "/929/929"]));
		expect(out.patterns).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it("revalidates both books for a dedication range crossing a sefer boundary", async () => {
		stubDb({});
		const out = await resolveEntityChanges([
			{ kind: "dedication", id: 7, perekRanges: [{ low: 50, high: 51 }] },
		]);
		expect(out.tags).toEqual(["perek:50:dedications", "perek:51:dedications"]);
		expect(out.paths).toEqual(
			expect.arrayContaining(["/929/1", "/929/50", "/929/51", "/929/90"]),
		);
		expect(out.paths).not.toContain("/929/91");
		expect(out.paths).toHaveLength(90);
		expect(out.urls).toEqual(out.paths);
	});

	it("preserves article and entry invalidation tags after their target rows were deleted", async () => {
		mockQuery.mockResolvedValue([]);
		const out = await resolveEntityChanges([
			{
				kind: "dedication",
				id: 7,
				articleIds: [9],
				entryIds: ["deleted-entry"],
			},
		]);
		expect(out.tags).toEqual([
			"article:9:dedications",
			"pedia-entry:deleted-entry:dedications",
		]);
		expect(out.paths).toEqual([]);
		expect(mockQuery.mock.calls.map(([, params]) => params)).toEqual([
			[9],
			["deleted-entry"],
		]);
	});

	it("propagates article and entry lookup failures so callers can retry invalidation", async () => {
		for (const scope of [{ articleIds: [9] }, { entryIds: ["entry"] }]) {
			mockQuery.mockRejectedValueOnce(new Error("database unavailable"));
			await expect(
				resolveEntityChanges([{ kind: "dedication", id: 7, ...scope }]),
			).rejects.toThrow("database unavailable");
		}
	});

	it("does not invent descendant routes for unknown ancestors", async () => {
		stubDb({});
		const out = await resolveEntityChanges([
			{
				kind: "dedication",
				id: 7,
				seferIds: [999],
				helekIds: [999],
				perekRanges: [{ low: 930, high: 930 }],
			},
		]);
		expect(out.tags).toEqual(
			expect.arrayContaining([
				"sefer:999:dedications",
				"helek:999:dedications",
				"perek:930:dedications",
			]),
		);
		expect(out.paths).toEqual(["/929/930", "/", "/bookshelf"]);
	});

	it("treats empty assignment lists and masora false as an unscoped change", async () => {
		stubDb({});
		const out = await resolveEntityChanges([
			{
				kind: "dedication",
				id: 7,
				perekRanges: [],
				seferIds: [],
				helekIds: [],
				parashaIds: [],
				articleIds: [],
				entryIds: [],
				masora: false,
			},
		]);
		expect(out.tags).toEqual([
			"dedications",
			"dedications:bookshelf",
			"masora:dedications",
		]);
		expect(out.paths).toEqual(["/", "/bookshelf"]);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it("coalesces old and new scope assignments across repeated dedication events", async () => {
		stubDb({});
		const out = await resolveEntityChanges([
			{ kind: "dedication", id: 7, parashaIds: [2, 3], masora: true },
			{ kind: "dedication", id: 7, parashaIds: [3, 4], masora: true },
		]);
		expect(out.tags).toEqual([
			"parasha:2:dedications",
			"parasha:3:dedications",
			"masora:dedications",
			"parasha:4:dedications",
		]);
		expect(out.paths).toEqual(["/parasha/2", "/parasha/3", "/parasha/4"]);
	});

	it("resolves a perek-range dedication change to its perakim", async () => {
		stubDb({});
		// Perakim 3-4 sit inside בראשית (1-50): their flat pages changed,
		// and so did the book spread of every other perek in the sefer —
		// the range also fans out to the whole sefer's /929 paths (#2731).
		const out = await resolveEntityChanges([
			{ kind: "dedication", id: 7, perekRanges: [{ low: 3, high: 4 }] },
		]);
		expect(out.tags).toEqual(
			expect.arrayContaining(["perek:3:dedications", "perek:4:dedications"]),
		);
		expect(out.paths).toEqual(
			expect.arrayContaining(["/929/1", "/929/3", "/929/4", "/929/50"]),
		);
		expect(out.paths).not.toContain("/929/51");
		expect(out.paths.filter((p) => p.startsWith("/929/"))).toHaveLength(50);
	});

	it("expires a sefer dedication across its whole perek range", async () => {
		stubDb({});
		// Sefer 1 (בראשית) spans canonical perakim 1..50 — the flat perek
		// pages render ancestor dedications in their headings, so every
		// one of them changed (#2731).
		const out = await resolveEntityChanges([
			{ kind: "dedication", id: 7, seferIds: [1] },
		]);
		expect(out.tags).toEqual(
			expect.arrayContaining(["sefer:1:dedications", "dedications:bookshelf"]),
		);
		expect(out.paths).toEqual(
			expect.arrayContaining(["/", "/bookshelf", "/929/1", "/929/50"]),
		);
		expect(out.paths).not.toContain("/929/51");
		expect(out.paths.filter((p) => p.startsWith("/929/"))).toHaveLength(50);
	});

	it("expires a helek dedication across every sefer it owns", async () => {
		stubDb({});
		// Helek 3 (כתובים) spans canonical perakim 568..929.
		const out = await resolveEntityChanges([
			{ kind: "dedication", id: 7, helekIds: [3] },
		]);
		expect(out.tags).toEqual(
			expect.arrayContaining(["helek:3:dedications", "dedications:bookshelf"]),
		);
		expect(out.paths).toEqual(
			expect.arrayContaining(["/929/568", "/929/686", "/929/929"]),
		);
		expect(out.paths).not.toContain("/929/567");
		expect(out.paths.filter((p) => p.startsWith("/929/"))).toHaveLength(
			929 - 568 + 1,
		);
	});

	it("resolves parasha, article, entry and masora dedication scopes", async () => {
		mockQuery.mockImplementation(async (sql: string) => {
			if (/FROM tanah_article/.test(sql)) return [{ perek_id: 5 }];
			if (/FROM tanahpedia_entry/.test(sql))
				return [{ unique_name: "persons#abraham" }];
			throw new Error(`unstubbed SQL: ${sql}`);
		});
		const out = await resolveEntityChanges([
			{
				kind: "dedication",
				id: 7,
				parashaIds: [2],
				articleIds: [9],
				entryIds: ["123"],
				masora: true,
			},
		]);
		expect(out.tags).toEqual(
			expect.arrayContaining([
				"parasha:2:dedications",
				"article:9:dedications",
				"pedia-entry:123:dedications",
				"masora:dedications",
			]),
		);
		expect(out.paths).toEqual(
			expect.arrayContaining([
				"/parasha/2",
				"/929/5/9",
				"/pedia/persons#abraham",
			]),
		);
	});

	it("expires every dedication surface on an unscoped delete", async () => {
		stubDb({});
		const out = await resolveEntityChanges([{ kind: "dedication", id: 7 }]);
		expect(out.tags).toEqual(
			expect.arrayContaining([
				"dedications",
				"dedications:bookshelf",
				"masora:dedications",
			]),
		);
	});
});
