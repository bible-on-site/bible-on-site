/**
 * Dedication resolver tests (#2731): scope matching, ancestor expansion,
 * UTC expiry semantics, deduplication and rollout degradation are all
 * covered by stubbing the raw `query` layer with per-table fixtures.
 */
import { query } from "../../../src/lib/api-client";

jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import {
	parseExpiryUtc,
	resolveDedications,
	seferIdByName,
	seferPerekIds,
} from "../../../src/lib/dedications/service";
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
			parasha: [
				{ parasha_id: 4, dedication_id: 20, expires_at: null },
			],
			article: [
				{ article_id: 9, dedication_id: 21, expires_at: null },
			],
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
		expect(out[0].scopes.map((s) => s.kind).sort()).toEqual([
			"PEREK",
			"SEFER",
		]);
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

describe("formatDedication", () => {
	it("joins purposes in parentheses after the subject", () => {
		expect(
			formatDedication({ subject: "מרדכי בן זאב", purposes: ['לע"נ'] }),
		).toBe('מוקדש למרדכי בן זאב (לע"נ)');
	});

	it("omits the parentheses when no purposes exist", () => {
		expect(
			formatDedication({ subject: "יעל בת רחל", purposes: [] }),
		).toBe("מוקדש ליעל בת רחל");
	});

	it("skips blank purposes", () => {
		expect(
			formatDedication({ subject: "x", purposes: ["  ", 'לע"נ'] }),
		).toBe('מוקדש לx (לע"נ)');
	});
});
