/**
 * Dedication resolver tests (#2731): scope matching, ancestor expansion,
 * UTC expiry semantics, deduplication and rollout degradation are all
 * covered by stubbing the raw `query` layer with per-table fixtures.
 */
import { query } from "../../../src/lib/api-client";

jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

// The cached loaders run through unstable_cache in production; in unit
// tests a passthrough keeps every call live so fixture tables apply per
// test, while recording the stamped tags for invalidation-contract checks
// (same convention as tests/unit/lib/revalidate/tags.test.ts).
const mockCacheDefinitions: { key: unknown; opts: unknown }[] = [];
const mockUnstableCache = jest.fn(
	(fn: (...a: unknown[]) => unknown, key: unknown, opts: unknown) => {
		mockCacheDefinitions.push({ key, opts });
		return (...a: unknown[]) => fn(...a);
	},
);
jest.mock("next/cache", () => ({
	unstable_cache: (
		fn: (...a: unknown[]) => unknown,
		key: unknown,
		opts: unknown,
	) => mockUnstableCache(fn, key, opts),
}));

/** The `opts` passed to unstable_cache for a given `[baseKey, key]` pair. */
function stampedTags(baseKey: string, key: string): string[] {
	return stampedOpts(baseKey, key)?.tags ?? [];
}

/** The whole `opts` (tags + revalidate bound) stamped on one cache entry. */
function stampedOpts(
	baseKey: string,
	key?: string,
): { tags?: string[]; revalidate?: number | false } | undefined {
	// Aggregate caches and per-key wrappers are defined once. Keep their
	// options without re-importing sources: isolateModules replaces the
	// SWC coverage counters for the same instrumented module mid-suite.
	const definition = mockCacheDefinitions.find(
		({ key: k }) =>
			Array.isArray(k) &&
			k[0] === baseKey &&
			(key === undefined || k[1] === key),
	);
	return definition?.opts as
		| { tags?: string[]; revalidate?: number | false }
		| undefined;
}

import {
	helekIdBySeferId,
	parseExpiryUtc,
	resolveDedications,
	seferIdByName,
	seferIdByPerekId,
	seferPerekIds,
} from "../../../src/lib/dedications/service";
import type { DedicationContext } from "../../../src/lib/dedications/types";
import { formatDedication } from "../../../src/lib/dedications/types";

const mockQuery = query as jest.MockedFunction<typeof query>;

/** Routes every dedication SQL the service issues to a fixture table. */
interface FixtureTables {
	perek?: unknown[];
	sefer?: unknown[];
	helek?: unknown[];
	parasha?: unknown[];
	article?: unknown[];
	entry?: unknown[];
	masora?: unknown[];
	dedication?: unknown[];
	purposeLink?: unknown[];
	type?: unknown[];
}

function stubTables(tables: FixtureTables) {
	mockQuery.mockImplementation(async (sql: string) => {
		if (sql.includes("tanah_perek_dedication")) return tables.perek ?? [];
		if (sql.includes("tanah_sefer_dedication")) return tables.sefer ?? [];
		if (sql.includes("tanah_helek_dedication")) return tables.helek ?? [];
		if (sql.includes("tanah_parasha_dedication")) return tables.parasha ?? [];
		if (sql.includes("tanah_article_dedication")) return tables.article ?? [];
		if (sql.includes("tanahpedia_entry_dedication")) return tables.entry ?? [];
		if (sql.includes("tanah_masora_dedication")) return tables.masora ?? [];
		if (sql.includes("tanah_dedication_dedication_type"))
			return tables.purposeLink ?? [];
		if (sql.includes("tanah_dedication_type")) return tables.type ?? [];
		if (sql.includes("tanah_dedication")) return tables.dedication ?? [];
		throw new Error(`Unexpected SQL in test: ${sql}`);
		// biome-ignore lint/suspicious/noExplicitAny: test stub returns any row shape
	}) as any;
}

const NOW = new Date("2026-02-01T12:00:00Z");
const FUTURE = "2026-06-01 00:00:00";
const PAST = "2026-01-01 00:00:00";
const EXACT = "2026-02-01 12:00:00";

// Canonical ids (client-catalog order): בראשית = sefer 1, perek 1 = בראשית א.
const BERESHIT_SEFER_ID = 1;
const BERESHIT_FIRST_PEREK = 1;
const TORAH_HELEK_ID = 1;

beforeEach(() => {
	mockQuery.mockReset();
	mockUnstableCache.mockClear();
});

describe("parseExpiryUtc", () => {
	it("parses a MySQL DATETIME wall-clock as UTC", () => {
		expect(parseExpiryUtc("2026-02-01 12:00:00")?.toISOString()).toBe(
			"2026-02-01T12:00:00.000Z",
		);
	});

	it("returns null for a null expiry", () => {
		expect(parseExpiryUtc(null)).toBeNull();
	});

	it("returns null for an unparseable value", () => {
		expect(parseExpiryUtc("not-a-date")).toBeNull();
	});
});

describe("sefer helpers", () => {
	it("does not invent ancestors for ids outside the canonical corpus", () => {
		expect(seferIdByPerekId(0)).toBeUndefined();
		expect(seferIdByPerekId(930)).toBeUndefined();
		expect(helekIdBySeferId(0)).toBeUndefined();
		expect(helekIdBySeferId(999)).toBeUndefined();
	});

	it("enumerates canonical perek ids of a sefer", () => {
		const ids = seferPerekIds(BERESHIT_SEFER_ID);
		expect(ids[0]).toBe(1);
		expect(ids.length).toBe(50);
	});

	it("returns an empty range for an unknown sefer", () => {
		expect(seferPerekIds(999)).toEqual([]);
	});

	it("resolves canonical sefer ids by name", () => {
		expect(seferIdByName("בראשית")).toBe(BERESHIT_SEFER_ID);
		expect(seferIdByName("לא ספר")).toBeUndefined();
	});
});

describe("resolveDedications", () => {
	const scopeFixtures: [
		keyof FixtureTables,
		DedicationContext,
		Record<string, unknown>,
	][] = [
		["perek", { perekIds: [1] }, { perek_id_low: 1, perek_id_high: 2 }],
		["sefer", { seferIds: [1] }, { sefer_id: 1 }],
		["helek", { helekIds: [1] }, { helek_id: 1 }],
		["parasha", { parashaIds: [4] }, { parasha_id: 4 }],
		["article", { articleIds: [9] }, { article_id: 9 }],
		["entry", { entryIds: ["entry-1"] }, { entry_id: "entry-1" }],
		["masora", { masora: true }, {}],
	];

	it.each(scopeFixtures)(
		"keeps only live %s assignments at the exact UTC boundary",
		async (table, context, identity) => {
			stubTables({
				[table]: [
					{ ...identity, dedication_id: 1, expires_at: EXACT },
					{ ...identity, dedication_id: 2, expires_at: PAST },
					{ ...identity, dedication_id: 3, expires_at: FUTURE },
				],
				dedication: [{ id: 3, subject: "live", expires_at: FUTURE }],
			});
			const out = await resolveDedications(context, NOW);
			expect(out).toHaveLength(1);
			expect(out[0].id).toBe(3);
			expect(out[0].expiresAt?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
			expect(out[0].scopes[0].expiresAt?.toISOString()).toBe(
				"2026-06-01T00:00:00.000Z",
			);
		},
	);

	it("does not attach unrelated direct scopes to a matched dedication", async () => {
		stubTables({
			sefer: [{ sefer_id: 2, dedication_id: 10, expires_at: null }],
			helek: [{ helek_id: 2, dedication_id: 10, expires_at: null }],
			parasha: [{ parasha_id: 5, dedication_id: 10, expires_at: null }],
			article: [{ article_id: 10, dedication_id: 10, expires_at: null }],
			entry: [{ entry_id: "other", dedication_id: 10, expires_at: null }],
			masora: [{ dedication_id: 10, expires_at: null }],
			dedication: [{ id: 10, subject: "masora only", expires_at: null }],
		});
		const out = await resolveDedications(
			{
				seferIds: [1],
				helekIds: [1],
				parashaIds: [4],
				articleIds: [9],
				entryIds: ["requested"],
				masora: true,
			},
			NOW,
		);
		expect(out[0].scopes).toEqual([{ kind: "MASORA", expiresAt: null }]);
	});

	it("deduplicates repeated scopes, skips orphaned rows, and sorts results and purposes", async () => {
		const scope = {
			perek_id_low: 1,
			perek_id_high: 2,
			dedication_id: 20,
			expires_at: null,
		};
		stubTables({
			perek: [
				scope,
				{ ...scope },
				{ ...scope, dedication_id: 10 },
				{ ...scope, dedication_id: 99 },
			],
			dedication: [
				{ id: 20, subject: "second", expires_at: null },
				{ id: 10, subject: "first", expires_at: null },
			],
			purposeLink: [
				{ dedication_id: 20, dedication_type_id: 2 },
				{ dedication_id: 20, dedication_type_id: 1 },
				{ dedication_id: 20, dedication_type_id: 99 },
			],
			type: [
				{ id: 1, description: "A" },
				{ id: 2, description: "Z" },
			],
		});
		const out = await resolveDedications({ perekIds: [1, 2] }, NOW);
		expect(out.map((dedication) => dedication.id)).toEqual([10, 20]);
		expect(out.map((dedication) => dedication.scopes.length)).toEqual([1, 1]);
		expect(out[0].purposes).toEqual([]);
		expect(out[1].purposes).toEqual(["A", "Z"]);
		expect(
			mockQuery.mock.calls.find(([sql]) => sql.includes("WHERE id IN"))?.[1],
		).toEqual([10, 20, 99]);
	});

	it("ignores unknown ancestors while retaining an explicitly requested valid helek", async () => {
		stubTables({
			helek: [{ helek_id: 1, dedication_id: 10, expires_at: null }],
			dedication: [{ id: 10, subject: "known helek", expires_at: null }],
		});
		expect(
			await resolveDedications(
				{ perekIds: [930], seferIds: [999], helekIds: [1] },
				NOW,
			),
		).toMatchObject([{ id: 10, scopes: [{ kind: "HELEK", helekId: 1 }] }]);
	});

	it("degrades a missing expiry column during a partial schema rollout", async () => {
		mockQuery.mockRejectedValue(
			Object.assign(new Error("column missing"), {
				code: "ER_BAD_FIELD_ERROR",
			}),
		);
		expect(await resolveDedications({ perekIds: [1] }, NOW)).toEqual([]);
	});

	it("returns nothing when no context identities are given", async () => {
		stubTables({});
		expect(await resolveDedications({}, NOW)).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it("matches a direct perek range and attaches purposes", async () => {
		stubTables({
			perek: [
				{
					perek_id_low: BERESHIT_FIRST_PEREK,
					perek_id_high: 3,
					dedication_id: 10,
					expires_at: null,
				},
			],
			dedication: [{ id: 10, subject: "ראובן בן יקוט", expires_at: null }],
			purposeLink: [{ dedication_id: 10, dedication_type_id: 2 }],
			type: [
				{ id: 1, description: 'לע"נ' },
				{ id: 2, description: "לרפואה" },
			],
		});
		const out = await resolveDedications(
			{ perekIds: [BERESHIT_FIRST_PEREK] },
			NOW,
		);
		expect(out).toHaveLength(1);
		expect(out[0].subject).toBe("ראובן בן יקוט");
		expect(out[0].purposes).toEqual(["לרפואה"]);
		expect(out[0].scopes[0]).toMatchObject({ kind: "PEREK", perekIdLow: 1 });
	});

	it("does not match a perek outside the assigned range", async () => {
		stubTables({
			perek: [
				{
					perek_id_low: 5,
					perek_id_high: 7,
					dedication_id: 10,
					expires_at: null,
				},
			],
			dedication: [{ id: 10, subject: "x", expires_at: null }],
		});
		expect(
			await resolveDedications({ perekIds: [BERESHIT_FIRST_PEREK] }, NOW),
		).toEqual([]);
	});

	it("expands perek -> sefer -> helek ancestors", async () => {
		stubTables({
			sefer: [
				{
					sefer_id: BERESHIT_SEFER_ID,
					dedication_id: 11,
					expires_at: null,
				},
			],
			helek: [
				{
					helek_id: TORAH_HELEK_ID,
					dedication_id: 12,
					expires_at: null,
				},
			],
			dedication: [
				{ id: 11, subject: "sefer dedication", expires_at: null },
				{ id: 12, subject: "helek dedication", expires_at: null },
			],
		});
		const out = await resolveDedications(
			{ perekIds: [BERESHIT_FIRST_PEREK] },
			NOW,
		);
		expect(out.map((d) => d.id).sort()).toEqual([11, 12]);
		expect(out[0].scopes.map((s) => s.kind)).toContain("SEFER");
		expect(out[1].scopes.map((s) => s.kind)).toContain("HELEK");
	});

	it("matches parasha, article, entry and masora scopes", async () => {
		stubTables({
			parasha: [{ parasha_id: 4, dedication_id: 20, expires_at: null }],
			article: [{ article_id: 9, dedication_id: 21, expires_at: null }],
			entry: [
				{
					entry_id: "persons#abraham",
					dedication_id: 22,
					expires_at: null,
				},
			],
			masora: [{ dedication_id: 23, expires_at: null }],
			dedication: [
				{ id: 20, subject: "p", expires_at: null },
				{ id: 21, subject: "a", expires_at: null },
				{ id: 22, subject: "e", expires_at: null },
				{ id: 23, subject: "m", expires_at: null },
			],
		});
		const out = await resolveDedications(
			{
				parashaIds: [4],
				articleIds: [9],
				entryIds: ["persons#abraham"],
				masora: true,
			},
			NOW,
		);
		expect(out.map((d) => d.id)).toEqual([20, 21, 22, 23]);
	});

	it("does not load masora rows unless the context opts in", async () => {
		stubTables({
			masora: [{ dedication_id: 23, expires_at: null }],
			dedication: [{ id: 23, subject: "m", expires_at: null }],
		});
		expect(await resolveDedications({ parashaIds: [4] }, NOW)).toEqual([]);
	});

	it("excludes an assignment whose expiry already passed", async () => {
		stubTables({
			perek: [
				{
					perek_id_low: 1,
					perek_id_high: 3,
					dedication_id: 10,
					expires_at: PAST,
				},
			],
			dedication: [{ id: 10, subject: "x", expires_at: null }],
		});
		expect(await resolveDedications({ perekIds: [1] }, NOW)).toEqual([]);
	});

	it("excludes an assignment expiring at the exact instant", async () => {
		stubTables({
			perek: [
				{
					perek_id_low: 1,
					perek_id_high: 3,
					dedication_id: 10,
					expires_at: EXACT,
				},
			],
			dedication: [{ id: 10, subject: "x", expires_at: null }],
		});
		expect(await resolveDedications({ perekIds: [1] }, NOW)).toEqual([]);
	});

	it("includes an assignment expiring in the future", async () => {
		stubTables({
			perek: [
				{
					perek_id_low: 1,
					perek_id_high: 3,
					dedication_id: 10,
					expires_at: FUTURE,
				},
			],
			dedication: [{ id: 10, subject: "x", expires_at: null }],
		});
		expect(await resolveDedications({ perekIds: [1] }, NOW)).toHaveLength(1);
	});

	it("excludes a dedication whose own expiry passed even when the assignment is active", async () => {
		stubTables({
			perek: [
				{
					perek_id_low: 1,
					perek_id_high: 3,
					dedication_id: 10,
					expires_at: null,
				},
			],
			dedication: [{ id: 10, subject: "x", expires_at: PAST }],
		});
		expect(await resolveDedications({ perekIds: [1] }, NOW)).toEqual([]);
	});

	it("deduplicates a dedication matched through several scopes", async () => {
		stubTables({
			perek: [
				{
					perek_id_low: 1,
					perek_id_high: 3,
					dedication_id: 10,
					expires_at: null,
				},
			],
			sefer: [
				{
					sefer_id: BERESHIT_SEFER_ID,
					dedication_id: 10,
					expires_at: null,
				},
			],
			dedication: [{ id: 10, subject: "x", expires_at: null }],
		});
		const out = await resolveDedications({ perekIds: [1] }, NOW);
		expect(out).toHaveLength(1);
		expect(out[0].scopes.map((s) => s.kind).sort()).toEqual(["PEREK", "SEFER"]);
	});

	it("returns no dedications when the schema is not deployed yet", async () => {
		mockQuery.mockRejectedValue(
			Object.assign(new Error("table missing"), { code: "ER_NO_SUCH_TABLE" }),
		);
		expect(await resolveDedications({ perekIds: [1] }, NOW)).toEqual([]);
	});

	it("propagates a non-schema query failure", async () => {
		mockQuery.mockRejectedValue(
			Object.assign(new Error("gone"), { code: "ER_OTHER" }),
		);
		await expect(resolveDedications({ perekIds: [1] }, NOW)).rejects.toThrow(
			"gone",
		);
	});
});

describe("cached loader tag contracts", () => {
	it("keeps unknown perek and sefer cache keys free of invented ancestor tags", async () => {
		stubTables({});
		const { getPerekDedications, getSeferDedications } = await import(
			"../../../src/lib/dedications/loaders"
		);
		expect(await getPerekDedications(930)).toEqual([]);
		expect(await getSeferDedications(999)).toEqual([]);
		expect(stampedTags("perek-dedications", "930")).toEqual([
			"dedications",
			"perek:930:dedications",
		]);
		expect(stampedTags("sefer-dedications", "999")).toEqual([
			"dedications",
			"sefer:999:dedications",
		]);
	});

	it("loads each independent reading surface with its own identity and cache tag", async () => {
		stubTables({
			helek: [{ helek_id: 2, dedication_id: 12, expires_at: null }],
			parasha: [{ parasha_id: 4, dedication_id: 20, expires_at: null }],
			article: [{ article_id: 9, dedication_id: 21, expires_at: null }],
			entry: [{ entry_id: "entry-1", dedication_id: 22, expires_at: null }],
			dedication: [12, 20, 21, 22].map((id) => ({
				id,
				subject: String(id),
				expires_at: null,
			})),
		});
		const loaders = await import("../../../src/lib/dedications/loaders");
		expect((await loaders.getHelekDedications(2)).map((d) => d.id)).toEqual([
			12,
		]);
		expect((await loaders.getParashaDedications(4)).map((d) => d.id)).toEqual([
			20,
		]);
		expect((await loaders.getArticleDedications(9)).map((d) => d.id)).toEqual([
			21,
		]);
		expect(
			(await loaders.getEntryDedications("entry-1")).map((d) => d.id),
		).toEqual([22]);
		expect(stampedTags("helek-dedications", "2")).toEqual([
			"dedications",
			"helek:2:dedications",
		]);
		expect(stampedTags("parasha-dedications", "4")).toEqual([
			"dedications",
			"parasha:4:dedications",
		]);
		expect(stampedTags("article-dedications", "9")).toEqual([
			"dedications",
			"article:9:dedications",
		]);
		expect(stampedTags("pedia-entry-dedications", "entry-1")).toEqual([
			"dedications",
			"pedia-entry:entry-1:dedications",
		]);
	});

	it("tags perek entries with their sefer and helek ancestors", async () => {
		stubTables({});
		const { getPerekDedications } = await import(
			"../../../src/lib/dedications/loaders"
		);
		await getPerekDedications(BERESHIT_FIRST_PEREK);
		// בראשית perek 1 -> sefer 1 (בראשית) -> helek 1 (תורה): an ancestor
		// scope change must expire this entry, not just its own tag.
		expect(stampedTags("perek-dedications", "1")).toEqual([
			"dedications",
			"perek:1:dedications",
			"sefer:1:dedications",
			"helek:1:dedications",
		]);
	});

	it("tags sefer entries with their helek ancestor", async () => {
		stubTables({});
		const { getSeferDedications } = await import(
			"../../../src/lib/dedications/loaders"
		);
		await getSeferDedications(BERESHIT_SEFER_ID);
		expect(stampedTags("sefer-dedications", "1")).toEqual([
			"dedications",
			"sefer:1:dedications",
			"helek:1:dedications",
		]);
	});

	it.each(["בראשית", "תהילים"])(
		"tags the %s spread map within the framework limit",
		async (name) => {
			stubTables({});
			const { getSeferPerekDedicationLines } = await import(
				"../../../src/lib/dedications/loaders"
			);
			const seferId = seferIdByName(name);
			if (seferId === undefined) throw new Error(`Unknown sefer: ${name}`);
			await getSeferPerekDedicationLines(seferId);
			const tags = stampedTags(
				"sefer-perek-dedication-lines-v3",
				String(seferId),
			);
			expect(tags.length).toBeLessThanOrEqual(128);
			expect(tags).toEqual([
				"dedications",
				`sefer:${seferId}:perek-dedications`,
			]);
			const { resolveEntityChanges } = await import(
				"../../../src/lib/revalidate/dependencies"
			);
			for (const perekId of seferPerekIds(seferId)) {
				const invalidation = await resolveEntityChanges([
					{
						kind: "dedication",
						id: 7,
						perekRanges: [{ low: perekId, high: perekId }],
					},
				]);
				expect(invalidation.tags.some((tag) => tags.includes(tag))).toBe(true);
			}
		},
	);

	it("tags the sefer spread map with one aggregate tag and the global fallback", async () => {
		stubTables({});
		const { getSeferPerekDedicationLines } = await import(
			"../../../src/lib/dedications/loaders"
		);
		await getSeferPerekDedicationLines(BERESHIT_SEFER_ID);
		const tags = stampedTags("sefer-perek-dedication-lines-v3", "1");
		expect(tags).toEqual(["dedications", "sefer:1:perek-dedications"]);
	});

	it("keeps the largest book below the tag limit and invalidates its last perek's aggregate", async () => {
		// תהילים spans 568..717 (150 chapters). One tag per chapter used
		// to exceed Next's 128-tag limit, dropping tags near this last perek.
		expect(seferPerekIds(25)).toHaveLength(150);
		stubTables({
			perek: [
				{
					perek_id_low: 717,
					perek_id_high: 717,
					dedication_id: 10,
					expires_at: null,
				},
			],
			dedication: [{ id: 10, subject: "last chapter", expires_at: null }],
		});
		const { getPerekDedications, getSeferPerekDedicationLines } = await import(
			"../../../src/lib/dedications/loaders"
		);
		expect(await getSeferPerekDedicationLines(25)).toEqual({
			717: ["last chapter"],
		});
		await getPerekDedications(717);
		const tags = stampedTags("sefer-perek-dedication-lines-v3", "25");
		expect(tags).toEqual(["dedications", "sefer:25:perek-dedications"]);
		expect(tags.length).toBeLessThanOrEqual(128);
		expect(
			stampedOpts("sefer-perek-dedication-lines-v3", "25")?.revalidate,
		).toBe(false);

		const { resolveEntityChanges } = await import(
			"../../../src/lib/revalidate/dependencies"
		);
		const invalidation = await resolveEntityChanges([
			{ kind: "dedication", id: 10, perekRanges: [{ low: 717, high: 717 }] },
		]);
		// Check the producer/consumer contract together: the same scoped
		// event expires both the flat heading and the whole book spread,
		// without falling back to invalidating every book's dedications.
		expect(tags.filter((tag) => invalidation.tags.includes(tag))).toEqual([
			"sefer:25:perek-dedications",
		]);
		expect(
			stampedTags("perek-dedications", "717").filter((tag) =>
				invalidation.tags.includes(tag),
			),
		).toEqual(["perek:717:dedications"]);
		expect(invalidation.paths).toHaveLength(150);
		expect(invalidation.paths).toEqual(
			expect.arrayContaining(["/929/568", "/929/717"]),
		);
		expect(invalidation.urls).toEqual(invalidation.paths);
	});

	it("stamps no time bound so consuming routes stay fully static", async () => {
		stubTables({});
		const loaders = await import("../../../src/lib/dedications/loaders");
		await loaders.getPerekDedications(BERESHIT_FIRST_PEREK);
		await loaders.getMasoraDedications();
		await loaders.getBookshelfDedications();
		// A positive `revalidate` propagates to every consuming route's
		// `initialRevalidateSeconds`, converting the fully-SSG reading
		// surface to ISR (route-rendering.test.ts). Clock-driven expiry is
		// instead invalidated by the admin wake-up + startup rescan via
		// `revalidateTag` (#2731).
		expect(stampedOpts("perek-dedications", "1")?.revalidate).toBe(false);
		expect(stampedOpts("masora-dedications")?.revalidate).toBe(false);
		expect(stampedOpts("bookshelf-dedications")?.revalidate).toBe(false);
	});
});

describe("getSeferPerekDedicationLines", () => {
	// Lazily required per test so the unstable_cache mock above applies.
	const load = async (seferId: number) => {
		const { getSeferPerekDedicationLines } = await import(
			"../../../src/lib/dedications/loaders"
		);
		return getSeferPerekDedicationLines(seferId);
	};

	it("shows an overlapping dedication only once on each spread", async () => {
		stubTables({
			perek: [
				{
					perek_id_low: 1,
					perek_id_high: 3,
					dedication_id: 10,
					expires_at: null,
				},
				{
					perek_id_low: 2,
					perek_id_high: 4,
					dedication_id: 10,
					expires_at: null,
				},
			],
			dedication: [{ id: 10, subject: "one dedication", expires_at: null }],
		});
		expect(await load(1)).toEqual({
			1: ["one dedication"],
			2: ["one dedication"],
			3: ["one dedication"],
			4: ["one dedication"],
		});
	});

	it("does not query the database for an unknown sefer", async () => {
		stubTables({});
		expect(await load(999)).toEqual({});
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it("attaches each line to exactly the perakim its PEREK scope covers", async () => {
		stubTables({
			perek: [
				{
					perek_id_low: 2,
					perek_id_high: 4,
					dedication_id: 10,
					expires_at: null,
				},
			],
			dedication: [{ id: 10, subject: "ראובן בן יקוט", expires_at: null }],
			purposeLink: [{ dedication_id: 10, dedication_type_id: 2 }],
			type: [{ id: 2, description: "לרפואה" }],
		});
		const map = await load(BERESHIT_SEFER_ID);
		expect(map[1]).toBeUndefined();
		expect(map[2]).toEqual(["לרפואת ראובן בן יקוט"]);
		expect(map[3]).toEqual(["לרפואת ראובן בן יקוט"]);
		expect(map[4]).toEqual(["לרפואת ראובן בן יקוט"]);
		expect(map[5]).toBeUndefined();
	});

	it("omits dedications that apply only through a sefer or helek scope", async () => {
		stubTables({
			sefer: [
				{
					sefer_id: BERESHIT_SEFER_ID,
					dedication_id: 11,
					expires_at: null,
				},
			],
			helek: [
				{
					helek_id: TORAH_HELEK_ID,
					dedication_id: 12,
					expires_at: null,
				},
			],
			dedication: [
				{ id: 11, subject: "sefer", expires_at: null },
				{ id: 12, subject: "helek", expires_at: null },
			],
		});
		expect(await load(BERESHIT_SEFER_ID)).toEqual({});
	});

	it("clamps a cross-sefer range to the queried sefer's perakim", async () => {
		// בראשית ends at perek 50; a 49..55 range reaches into שמות.
		stubTables({
			perek: [
				{
					perek_id_low: 49,
					perek_id_high: 55,
					dedication_id: 10,
					expires_at: null,
				},
			],
			dedication: [{ id: 10, subject: "x", expires_at: null }],
		});
		const map = await load(BERESHIT_SEFER_ID);
		expect(
			Object.keys(map)
				.map(Number)
				.sort((a, b) => a - b),
		).toEqual([49, 50]);
	});

	it("keeps several dedications on one perek in dedication-id order", async () => {
		stubTables({
			perek: [
				{
					perek_id_low: 7,
					perek_id_high: 9,
					dedication_id: 20,
					expires_at: null,
				},
				{
					perek_id_low: 7,
					perek_id_high: 7,
					dedication_id: 10,
					expires_at: null,
				},
			],
			dedication: [
				{ id: 10, subject: "a", expires_at: null },
				{ id: 20, subject: "b", expires_at: null },
			],
		});
		const map = await load(BERESHIT_SEFER_ID);
		expect(map[7]).toEqual(["a", "b"]);
		expect(map[8]).toEqual(["b"]);
	});
});

describe("getBookshelfDedications", () => {
	const load = async () => {
		const { getBookshelfDedications } = await import(
			"../../../src/lib/dedications/loaders"
		);
		return getBookshelfDedications();
	};

	it("resolves the whole shelf in one pass and buckets by matched scope", async () => {
		stubTables({
			helek: [
				{
					helek_id: TORAH_HELEK_ID,
					dedication_id: 12,
					expires_at: null,
				},
			],
			sefer: [
				{
					sefer_id: BERESHIT_SEFER_ID,
					dedication_id: 11,
					expires_at: null,
				},
			],
			dedication: [
				{ id: 11, subject: "sefer dedication", expires_at: null },
				{ id: 12, subject: "helek dedication", expires_at: null },
			],
		});
		const out = await load();
		expect(out.helek[TORAH_HELEK_ID]?.map((d) => d.id)).toEqual([12]);
		expect(out.sefer[BERESHIT_SEFER_ID]?.map((d) => d.id)).toEqual([11]);
		// One resolution for the whole shelf — the link tables are scanned
		// once, not once per helek and per sefer.
		const seferScans = mockQuery.mock.calls.filter(([sql]) =>
			(sql as string).includes("tanah_sefer_dedication"),
		);
		const helekScans = mockQuery.mock.calls.filter(([sql]) =>
			(sql as string).includes("tanah_helek_dedication"),
		);
		expect(seferScans).toHaveLength(1);
		expect(helekScans).toHaveLength(1);
	});

	it("lands a multi-scope dedication on every shelf it owns", async () => {
		stubTables({
			helek: [
				{
					helek_id: TORAH_HELEK_ID,
					dedication_id: 10,
					expires_at: null,
				},
			],
			sefer: [
				{
					sefer_id: BERESHIT_SEFER_ID,
					dedication_id: 10,
					expires_at: null,
				},
			],
			dedication: [{ id: 10, subject: "both", expires_at: null }],
		});
		const out = await load();
		expect(out.helek[TORAH_HELEK_ID]?.map((d) => d.id)).toEqual([10]);
		expect(out.sefer[BERESHIT_SEFER_ID]?.map((d) => d.id)).toEqual([10]);
	});

	it("keeps helek-only dedications off the sefer shelves", async () => {
		stubTables({
			helek: [
				{
					helek_id: TORAH_HELEK_ID,
					dedication_id: 12,
					expires_at: null,
				},
			],
			dedication: [{ id: 12, subject: "helek only", expires_at: null }],
		});
		const out = await load();
		expect(out.helek[TORAH_HELEK_ID]?.map((d) => d.id)).toEqual([12]);
		expect(Object.keys(out.sefer)).toEqual([]);
	});

	it("returns empty helek lists and no sefer entries when nothing applies", async () => {
		stubTables({});
		const out = await load();
		expect(Object.values(out.helek)).toEqual([[], [], []]);
		expect(out.sefer).toEqual({});
	});
});

describe("getBookshelfDedicationLines", () => {
	it("projects the buckets to display lines keyed by canonical names", async () => {
		stubTables({
			helek: [
				{
					helek_id: TORAH_HELEK_ID,
					dedication_id: 12,
					expires_at: null,
				},
			],
			sefer: [
				{
					sefer_id: BERESHIT_SEFER_ID,
					dedication_id: 11,
					expires_at: null,
				},
			],
			dedication: [
				{ id: 11, subject: "ראובן", expires_at: null },
				{ id: 12, subject: "שמעון", expires_at: null },
			],
			purposeLink: [{ dedication_id: 11, dedication_type_id: 1 }],
			type: [{ id: 1, description: 'לע"נ' }],
		});
		const { getBookshelfDedicationLines } = await import(
			"../../../src/lib/dedications/loaders"
		);
		const lines = await getBookshelfDedicationLines();
		expect(lines.bySefer.בראשית).toEqual(['לע"נ ראובן']);
		expect(lines.byHelek.תורה).toEqual(["שמעון"]);
	});
});

describe("formatDedication", () => {
	// Shared wording contract (#2849) — the same table drives the admin
	// preview and native DedicationFormatter tests.
	it.each([
		["לרפואה", ["לרפואה"], "מזל בת רחל", "לרפואת מזל בת רחל"],
		["רפואה שלימה", ["רפואה שלימה"], "מזל בת רחל", "לרפואת מזל בת רחל"],
		["already normalized לרפואת", ["לרפואת"], "ראובן בן יקוט", "לרפואת ראובן בן יקוט"],
		["padded healing variant", ["  רפואה   שלמה "], "מזל בת רחל", "לרפואת מזל בת רחל"],
		['לע"נ', ['לע"נ'], "יעל בת רחל", 'לע"נ יעל בת רחל'],
		["legacy gershayim", ["לע״נ"], "יעל בת רחל", 'לע"נ יעל בת רחל'],
		["no purposes", [], "יעל בת רחל", "יעל בת רחל"],
		["blank purposes only", ["  ", ""], "יעל בת רחל", "יעל בת רחל"],
		["multiple and custom purposes", ["רפואה שלימה", "להצלחת"], "מזל בת רחל", "לרפואת ולהצלחת מזל בת רחל"],
		["duplicate healing variants", ["לרפואה", "רפואה שלימה"], "מזל בת רחל", "לרפואת מזל בת רחל"],
		["subject starting with ל kept exactly", ["לרפואה"], "לאה בת שרה", "לרפואת לאה בת שרה"],
	])("renders %s purpose-first", (_case, purposes, subject, expected) => {
		const line = formatDedication({ subject, purposes });
		expect(line).toBe(expected);
		expect(line).not.toContain("מוקדש");
		expect(line).not.toMatch(/[()]/);
	});
});
