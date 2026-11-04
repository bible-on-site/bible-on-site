import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const conn = { marker: "tx-conn" };
	return {
		conn,
		query: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(),
		queryOne: vi.fn(),
		txExecute: vi.fn<
			(
				conn: unknown,
				sql: string,
				params?: unknown[],
			) => Promise<{ insertId: number; affectedRows: number }>
		>(async () => ({ insertId: 42, affectedRows: 1 })),
		transaction: vi.fn(async (fn: (c: typeof conn) => unknown) => fn(conn)),
		revalidateWebsite: vi.fn(),
		dedicationChange: vi.fn((input: Record<string, unknown>) => ({
			changes: [{ kind: "dedication", ...input }],
		})),
	};
});
vi.mock("~/server/db", () => ({
	query: mocks.query,
	queryOne: mocks.queryOne,
	transaction: mocks.transaction,
	txExecute: mocks.txExecute,
}));
vi.mock("~/server/website-revalidate", () => ({
	revalidateWebsite: mocks.revalidateWebsite,
	dedicationChange: mocks.dedicationChange,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				async (args: { data: unknown }) =>
					// Async boundary: validation failures reject like the real
					// server-fn transport instead of throwing synchronously.
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
}));

import {
	__resetDedicationExpiryForTests,
	clearDedicationExpiry,
	rescanDedicationExpiries,
	syncDedicationExpiry,
} from "~/server/dedication-expiry";
import type { DedicationTargetInput } from "~/server/dedications";
import {
	createDedication,
	deleteDedication,
	getDedication,
	getDedicationTargetOptions,
	getDedicationTypes,
	listDedications,
	normalizeExpiry,
	updateDedication,
} from "~/server/dedications";

interface FixtureRows {
	ids?: unknown[];
	state?: unknown[];
	dedication?: unknown[];
	purposeLink?: unknown[];
	type?: unknown[];
	perek?: unknown[];
	sefer?: unknown[];
	helek?: unknown[];
	parasha?: unknown[];
	article?: unknown[];
	entry?: unknown[];
	masora?: unknown[];
	seferNames?: unknown[];
	helekNames?: unknown[];
}

/**
 * Routes every SQL the dedications server module issues to a fixture
 * table. Order matters: the expiry-state and rescan unions mention every
 * link table, so their distinctive clauses are checked first, and the
 * bare `tanah_dedication`/`tanah_sefer` reads come after every
 * `*_dedication` link table.
 */
function stubQueries(rows: FixtureRows) {
	mocks.query.mockImplementation(async (sql: string) => {
		if (sql.startsWith("SELECT DISTINCT")) return rows.ids ?? [];
		if (sql.includes("MIN(CASE")) return rows.state ?? [];
		if (sql.includes("FROM tanah_dedication ")) return rows.dedication ?? [];
		if (sql.includes("tanah_dedication_dedication_type"))
			return rows.purposeLink ?? [];
		if (sql.includes("tanah_perek_dedication")) return rows.perek ?? [];
		if (sql.includes("tanah_sefer_dedication")) return rows.sefer ?? [];
		if (sql.includes("tanah_helek_dedication")) return rows.helek ?? [];
		if (sql.includes("tanah_parasha_dedication")) return rows.parasha ?? [];
		if (sql.includes("tanah_article_dedication")) return rows.article ?? [];
		if (sql.includes("tanahpedia_entry_dedication")) return rows.entry ?? [];
		if (sql.includes("tanah_masora_dedication")) return rows.masora ?? [];
		if (sql.includes("FROM tanah_sefer")) return rows.seferNames ?? [];
		if (sql.includes("FROM tanah_helek")) return rows.helekNames ?? [];
		if (sql.includes("tanah_dedication_type")) return rows.type ?? [];
		if (sql.includes("tanah_dedication")) return rows.dedication ?? [];
		throw new Error(`Unexpected SQL in test: ${sql}`);
	});
}

/** Lets a fire-and-forget `void sync...` chain finish its awaits. */
async function flush(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
	for (const mock of [mocks.query, mocks.queryOne, mocks.txExecute])
		mock.mockReset();
	mocks.txExecute.mockResolvedValue({ insertId: 42, affectedRows: 1 });
	mocks.transaction.mockClear();
	mocks.revalidateWebsite.mockReset();
	mocks.dedicationChange.mockClear();
});

afterEach(() => {
	__resetDedicationExpiryForTests();
	vi.useRealTimers();
});

describe("normalizeExpiry", () => {
	it("normalizes minute precision and ISO separators to DATETIME", () => {
		expect(normalizeExpiry("2030-01-02T03:04")).toBe("2030-01-02 03:04:00");
		expect(normalizeExpiry(" 2030-01-02 03:04:05 ")).toBe(
			"2030-01-02 03:04:05",
		);
	});

	it("returns null for empty values", () => {
		expect(normalizeExpiry(null)).toBeNull();
		expect(normalizeExpiry("  ")).toBeNull();
		expect(normalizeExpiry(undefined)).toBeNull();
	});

	it("rejects malformed or impossible values", () => {
		expect(() => normalizeExpiry("02.01.2030")).toThrow("תוקף");
		expect(() => normalizeExpiry("2030-13-40 99:99")).toThrow("תוקף");
	});

	it.each(["2030-02-29 12:00", "2030-04-31 12:00", "2030-01-01 24:00"])(
		"rejects calendar rollover instead of storing %s as a different instant",
		(value) => expect(() => normalizeExpiry(value)).toThrow("תוקף"),
	);

	it("accepts leap-day expiry without shifting UTC", () => {
		expect(normalizeExpiry("2032-02-29T23:59:59")).toBe("2032-02-29 23:59:59");
	});
});

describe("dedication management regression cases", () => {
	it("loads purpose and target options from the database", async () => {
		stubQueries({
			type: [{ id: 2, description: "לרפואה" }],
			seferNames: [{ id: 3, name: "ויקרא" }],
			helekNames: [{ id: 1, name: "תורה" }],
		});
		await expect(getDedicationTypes()).resolves.toEqual([
			{ id: 2, description: "לרפואה" },
		]);
		await expect(getDedicationTargetOptions()).resolves.toEqual({
			sefarim: [{ id: 3, name: "ויקרא" }],
			heleks: [{ id: 1, name: "תורה" }],
			parashaCount: 54,
		});
	});

	it("binds trimmed search text and skips assignment scans for an empty result", async () => {
		stubQueries({});
		await expect(
			listDedications({ data: { search: "  ראובן  ", show: "all" } }),
		).resolves.toEqual([]);
		expect(mocks.query.mock.calls[0][1]).toEqual(["%ראובן%"]);
		expect(mocks.query.mock.calls).toHaveLength(2);
	});

	it("restores every target identity, expiry and fallback label without mixing dedications", async () => {
		const expiry = "2030-01-02 03:04:05";
		stubQueries({
			dedication: [
				{ id: 9, subject: "ראובן", expires_at: expiry, expired: 0 },
				{ id: 10, subject: "שמעון", expires_at: null, expired: 1 },
			],
			purposeLink: [
				{ dedication_id: 9, dedication_type_id: 3 },
				{ dedication_id: 9, dedication_type_id: 2 },
				{ dedication_id: 9, dedication_type_id: 999 },
			],
			type: [
				{ id: 2, description: "א" },
				{ id: 3, description: "ב" },
			],
			perek: [
				{
					dedication_id: 9,
					perek_id_low: 17,
					perek_id_high: 22,
					expires_at: expiry,
				},
			],
			sefer: [{ dedication_id: 9, sefer_id: 3, expires_at: null }],
			helek: [
				{ dedication_id: 9, helek_id: 2, expires_at: null },
				{ dedication_id: 9, helek_id: 1, expires_at: null },
			],
			helekNames: [{ id: 1, name: "תורה" }],
			parasha: [{ dedication_id: 9, parasha_id: 54, expires_at: null }],
			article: [
				{
					dedication_id: 9,
					article_id: 7,
					name: "מאמר בדיקה",
					expires_at: null,
				},
				{ dedication_id: 9, article_id: 8, name: null, expires_at: null },
			],
			entry: [
				{
					dedication_id: 9,
					entry_id: "entry-1",
					unique_name: "ראובן",
					expires_at: null,
				},
				{
					dedication_id: 9,
					entry_id: "entry-2",
					unique_name: null,
					expires_at: null,
				},
			],
			masora: [{ dedication_id: 9, expires_at: expiry }],
		});
		const rows = await listDedications({ data: {} });
		expect(rows[0]).toMatchObject({
			expiresAt: expiry,
			purposes: ["א", "ב"],
			purposeTypeIds: [3, 2],
		});
		expect(rows[0].targets).toEqual([
			{
				kind: "perek",
				perekIdLow: 17,
				perekIdHigh: 22,
				label: "פרקים 17-22",
				expiresAt: expiry,
			},
			{ kind: "sefer", seferId: 3, label: "ספר 3", expiresAt: null },
			{ kind: "helek", helekId: 2, label: "חלק 2", expiresAt: null },
			{ kind: "helek", helekId: 1, label: "חלק תורה", expiresAt: null },
			{
				kind: "parasha",
				parashaId: 54,
				label: "פרשה שבועית #54",
				expiresAt: null,
			},
			{
				kind: "article",
				articleId: 7,
				label: "מאמר מאמר בדיקה",
				expiresAt: null,
			},
			{ kind: "article", articleId: 8, label: "מאמר 8", expiresAt: null },
			{
				kind: "entry",
				entryId: "entry-1",
				label: "ערך תנכפדיה ראובן",
				expiresAt: null,
			},
			{
				kind: "entry",
				entryId: "entry-2",
				label: "ערך תנכפדיה entry-2",
				expiresAt: null,
			},
			{
				kind: "masora",
				label: "מסורה על הפרק (כל היחידות)",
				expiresAt: expiry,
			},
		]);
		expect(rows[1]).toMatchObject({
			purposes: [],
			purposeTypeIds: [],
			targets: [],
			expired: true,
		});
	});

	it.each([
		{ kind: "perek", perekIdLow: 0, perekIdHigh: 2 },
		{ kind: "perek", perekIdLow: 3, perekIdHigh: 2 },
		{ kind: "perek", perekIdLow: 1.5, perekIdHigh: 2 },
		{ kind: "sefer" },
		{ kind: "helek", helekId: 1.5 },
		{ kind: "parasha", parashaId: 0 },
		{ kind: "parasha", parashaId: 55 },
		{ kind: "article" },
		{ kind: "entry", entryId: "  " },
		{ kind: "unknown" },
	])("rejects malformed target $kind before any writes", async (target) => {
		await expect(
			createDedication({
				data: {
					subject: "ראובן",
					purposeTypeIds: [],
					targets: [target as DedicationTargetInput],
				},
			}),
		).rejects.toThrow();
		expect(mocks.queryOne).not.toHaveBeenCalled();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it.each([null, [1.5], ["2"]])(
		"rejects invalid purpose ids %j before writing",
		async (purposeTypeIds) => {
			await expect(
				createDedication({
					data: {
						subject: "ראובן",
						purposeTypeIds: purposeTypeIds as number[],
						targets: [{ kind: "masora" }],
					},
				}),
			).rejects.toThrow("מטרות");
			expect(mocks.transaction).not.toHaveBeenCalled();
		},
	);

	it.each([
		[{ kind: "helek", helekId: 8 }, "חלק 8"],
		[{ kind: "perek", perekIdLow: 7, perekIdHigh: 9 }, "פרק 7"],
		[{ kind: "article", articleId: 7 }, "מאמר 7"],
		[{ kind: "entry", entryId: "missing" }, "missing"],
	] as const)(
		"rejects a missing referenced row %j",
		async (target, message) => {
			mocks.queryOne.mockResolvedValue(null);
			await expect(
				createDedication({
					data: {
						subject: "ראובן",
						purposeTypeIds: [],
						targets: [target],
					},
				}),
			).rejects.toThrow(message);
			expect(mocks.transaction).not.toHaveBeenCalled();
		},
	);

	it("checks both endpoints of a perek range", async () => {
		mocks.queryOne.mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce(null);
		await expect(
			createDedication({
				data: {
					subject: "ראובן",
					purposeTypeIds: [],
					targets: [{ kind: "perek", perekIdLow: 7, perekIdHigh: 9 }],
				},
			}),
		).rejects.toThrow("פרק 9");
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("writes all assignment kinds and normalized UTC expiry in one transaction", async () => {
		mocks.queryOne.mockResolvedValue({ id: 1 });
		stubQueries({});
		const expiry = "2030-01-02 03:04:00";
		const result = await createDedication({
			data: {
				subject: " ראובן ",
				purposeTypeIds: [2],
				expiresAt: "2030-01-02T03:04",
				targets: [
					{
						kind: "perek",
						perekIdLow: 1,
						perekIdHigh: 2,
						expiresAt: "2030-01-02T03:04",
					},
					{ kind: "helek", helekId: 1 },
					{ kind: "parasha", parashaId: 54 },
					{ kind: "article", articleId: 7 },
					{ kind: "entry", entryId: " entry-1 " },
					{ kind: "masora" },
				],
			},
		});
		expect(result).toMatchObject({
			id: 42,
			subject: "ראובן",
			expiresAt: expiry,
			purposeTypeIds: [2],
		});
		const writes = mocks.txExecute.mock.calls.map(([, sql, params]) => ({
			sql,
			params,
		}));
		for (const [table, params] of [
			["tanah_dedication", ["ראובן", expiry]],
			["tanah_perek_dedication", [1, 2, 42, expiry]],
			["tanah_helek_dedication", [1, 42, null]],
			["tanah_parasha_dedication", [54, 42, null]],
			["tanah_article_dedication", [7, 42, null]],
			["tanahpedia_entry_dedication", ["entry-1", 42, null]],
			["tanah_masora_dedication", [42, null]],
		] as const) {
			expect(
				writes.find((w) => w.sql.includes(`INTO ${table} (`))?.params,
			).toEqual(params);
		}
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
		expect(mocks.dedicationChange).toHaveBeenCalledWith(
			expect.objectContaining({
				perekRanges: [{ low: 1, high: 2 }],
				helekIds: [1],
				parashaIds: [54],
				articleIds: [7],
				masora: true,
			}),
		);
		await flush();
	});

	it("replaces purposes and assignments on update, then invalidates both scope sets", async () => {
		mocks.queryOne.mockResolvedValue({ id: 9 });
		stubQueries({
			perek: [{ perek_id_low: 3, perek_id_high: 5, expires_at: null }],
			helek: [{ helek_id: 1, expires_at: null }],
			parasha: [{ parasha_id: 3, expires_at: null }],
			article: [{ article_id: 7, expires_at: null }],
			entry: [{ entry_id: "old-entry", expires_at: null }],
			masora: [{ expires_at: null }],
		});
		await updateDedication({
			data: {
				id: 9,
				subject: "שמעון",
				purposeTypeIds: [2, 3],
				targets: [{ kind: "parasha", parashaId: 2 }],
			},
		});
		expect(mocks.txExecute).toHaveBeenCalledWith(
			mocks.conn,
			"INSERT INTO tanah_dedication_dedication_type (dedication_id, dedication_type_id) VALUES (?, ?)",
			[9, 3],
		);
		expect(mocks.dedicationChange).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 9,
				perekRanges: [{ low: 3, high: 5 }],
				helekIds: [1],
				articleIds: [7],
				entryIds: ["old-entry"],
				masora: true,
				parashaIds: [3, 2],
			}),
		);
		await flush();
	});

	it("does not publish invalidation or arm expiry after a failed transaction", async () => {
		mocks.txExecute.mockRejectedValueOnce(new Error("write failed"));
		await expect(
			createDedication({
				data: {
					subject: "ראובן",
					purposeTypeIds: [],
					targets: [{ kind: "masora" }],
				},
			}),
		).rejects.toThrow("write failed");
		expect(mocks.revalidateWebsite).not.toHaveBeenCalled();
		expect(mocks.query).not.toHaveBeenCalled();
	});
});

describe("expiry scheduling regression cases", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
	});

	it("cancels the previous wake when an expiry is moved or removed", async () => {
		stubQueries({
			state: [{ next_expiry: "2030-01-01 00:00:10", has_elapsed: 0 }],
		});
		await syncDedicationExpiry(9);
		expect(vi.getTimerCount()).toBe(1);
		stubQueries({
			state: [{ next_expiry: "2030-01-01 00:00:20", has_elapsed: 0 }],
		});
		await syncDedicationExpiry(9);
		expect(vi.getTimerCount()).toBe(1);
		mocks.query.mockClear();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(mocks.query).not.toHaveBeenCalled();
		stubQueries({});
		await syncDedicationExpiry(9);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("clears a deleted dedication's wake without affecting another dedication", async () => {
		stubQueries({
			state: [{ next_expiry: "2030-01-01 00:00:10", has_elapsed: 0 }],
		});
		await syncDedicationExpiry(9);
		await syncDedicationExpiry(10);
		clearDedicationExpiry(9);
		clearDedicationExpiry(999);
		expect(vi.getTimerCount()).toBe(1);
		await deleteDedication({ data: 10 });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("re-arms a far-future expiry at the timer cap without prematurely invalidating", async () => {
		stubQueries({
			state: [{ next_expiry: "2031-01-01 00:00:00", has_elapsed: 0 }],
		});
		await syncDedicationExpiry(9);
		mocks.query.mockClear();
		await vi.advanceTimersByTimeAsync(2_147_483_647);
		expect(mocks.query).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);
		expect(mocks.revalidateWebsite).not.toHaveBeenCalled();
	});

	it("logs a state-query failure without rejecting the save path", async () => {
		const error = new Error("database unavailable");
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.query.mockRejectedValue(error);
		try {
			await expect(syncDedicationExpiry(9)).resolves.toBeUndefined();
			expect(log).toHaveBeenCalledWith(
				"dedication expiry state failed for 9:",
				error,
			);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			log.mockRestore();
		}
	});

	it("still arms the next expiry if loading elapsed scopes fails", async () => {
		const error = new Error("target read failed");
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.query.mockImplementation(async (sql) => {
			if (sql.includes("MIN(CASE"))
				return [{ next_expiry: "2030-01-01 00:00:10", has_elapsed: 1 }];
			throw error;
		});
		try {
			await expect(syncDedicationExpiry(9)).resolves.toBeUndefined();
			expect(log).toHaveBeenCalledWith(
				"dedication expiry flush failed for 9:",
				error,
			);
			expect(vi.getTimerCount()).toBe(1);
			expect(mocks.revalidateWebsite).not.toHaveBeenCalled();
		} finally {
			log.mockRestore();
		}
	});
});

describe("listDedications", () => {
	it("requires a live target for the active tab", async () => {
		stubQueries({ dedication: [] });

		await listDedications({ data: { show: "active" } });

		const [sql] = mocks.query.mock.calls[0] as [string];
		expect(sql).toContain("d.expires_at > UTC_TIMESTAMP()");
		expect(sql).toContain("tanah_sefer_dedication lt");
		expect(sql).toContain("tanah_masora_dedication lt");
	});

	it("treats rows with no live target as expired", async () => {
		stubQueries({ dedication: [] });

		await listDedications({ data: { show: "expired" } });

		const [sql] = mocks.query.mock.calls[0] as [string];
		expect(sql).toContain("d.expires_at <= UTC_TIMESTAMP()");
		expect(sql).toContain("OR NOT (EXISTS");
		// The badge mirrors the tab rule — assignment expiry counts too.
		expect(sql).toContain("AS expired");
	});

	it("enriches rows with purposes and target labels", async () => {
		stubQueries({
			dedication: [{ id: 9, subject: "ראובן", expires_at: null, expired: 0 }],
			purposeLink: [{ dedication_id: 9, dedication_type_id: 2 }],
			type: [
				{ id: 1, description: 'לע"נ' },
				{ id: 2, description: "לרפואה" },
			],
			sefer: [{ dedication_id: 9, sefer_id: 3, expires_at: null }],
			seferNames: [{ id: 3, name: "ויקרא" }],
		});

		const out = await listDedications({ data: {} });

		expect(out).toHaveLength(1);
		expect(out[0].purposes).toEqual(["לרפואה"]);
		expect(out[0].purposeTypeIds).toEqual([2]);
		expect(out[0].expired).toBe(false);
		expect(out[0].targets[0]).toMatchObject({
			kind: "sefer",
			seferId: 3,
			label: "ספר ויקרא",
		});
	});
});

describe("getDedication", () => {
	it("returns null for a missing row", async () => {
		stubQueries({ dedication: [] });
		await expect(getDedication({ data: 5 })).resolves.toBeNull();
	});

	it("marks a row expired when every assignment lapsed", async () => {
		stubQueries({
			dedication: [{ id: 5, subject: "x", expires_at: null, expired: 1 }],
		});
		const out = await getDedication({ data: 5 });
		expect(out?.expired).toBe(true);
	});
});

describe("createDedication", () => {
	it("rejects an empty subject before touching the DB", async () => {
		await expect(
			createDedication({
				data: {
					subject: "  ",
					purposeTypeIds: [],
					targets: [{ kind: "masora" }],
				},
			}),
		).rejects.toThrow("שם המוקדש");
		expect(mocks.query).not.toHaveBeenCalled();
	});

	it("rejects a dedication with no targets", async () => {
		await expect(
			createDedication({
				data: { subject: "x", purposeTypeIds: [], targets: [] },
			}),
		).rejects.toThrow("יעד אחד");
	});

	it("rejects an unknown sefer target", async () => {
		mocks.queryOne.mockResolvedValue(null);
		await expect(
			createDedication({
				data: {
					subject: "x",
					purposeTypeIds: [],
					targets: [{ kind: "sefer", seferId: 99 }],
				},
			}),
		).rejects.toThrow("ספר 99 לא קיים");
	});

	it("writes the row, links, invalidates, and arms the expiry sync", async () => {
		mocks.queryOne.mockResolvedValue({ id: 3 });
		stubQueries({ state: [{ next_expiry: null, has_elapsed: 0 }] });

		const out = await createDedication({
			data: {
				subject: "ראובן",
				purposeTypeIds: [2],
				targets: [{ kind: "sefer", seferId: 3 }],
			},
		});

		expect(out.id).toBe(42);
		const written = mocks.txExecute.mock.calls.map(([, sql]) => sql);
		expect(written.some((s) => s.includes("INTO tanah_dedication "))).toBe(
			true,
		);
		expect(written.some((s) => s.includes("INTO tanah_sefer_dedication"))).toBe(
			true,
		);
		expect(
			written.some((s) => s.includes("INTO tanah_dedication_dedication_type")),
		).toBe(true);
		expect(mocks.dedicationChange).toHaveBeenCalledWith(
			expect.objectContaining({ id: 42, seferIds: [3] }),
		);
		await flush();
		const sqls = mocks.query.mock.calls.map(([sql]) => sql as string);
		// Post-commit expiry sync re-derived the earliest expiry (#2731).
		expect(sqls.some((s) => s.includes("MIN(CASE"))).toBe(true);
	});
});

describe("updateDedication", () => {
	it("rejects a missing dedication", async () => {
		mocks.queryOne.mockResolvedValue(null);
		await expect(
			updateDedication({
				data: {
					id: 9,
					subject: "x",
					purposeTypeIds: [],
					targets: [{ kind: "masora" }],
				},
			}),
		).rejects.toThrow("ההקדשה לא נמצאה");
	});

	it("merges old and new scopes into the invalidation", async () => {
		mocks.queryOne.mockResolvedValue({ id: 9 });
		stubQueries({
			sefer: [{ dedication_id: 9, sefer_id: 4, expires_at: null }],
			state: [{ next_expiry: "2030-01-01 00:00:00", has_elapsed: 0 }],
		});

		await updateDedication({
			data: {
				id: 9,
				subject: "y",
				purposeTypeIds: [],
				targets: [{ kind: "sefer", seferId: 7 }],
			},
		});

		expect(mocks.dedicationChange).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 9,
				seferIds: expect.arrayContaining([4, 7]),
			}),
		);
	});
});

describe("deleteDedication", () => {
	it("captures the assignment set before the cascade", async () => {
		stubQueries({
			sefer: [{ dedication_id: 9, sefer_id: 4, expires_at: null }],
		});

		await deleteDedication({ data: 9 });

		const written = mocks.txExecute.mock.calls.map(([, sql]) => sql);
		expect(
			written.some((s) => s.includes("DELETE FROM tanah_dedication")),
		).toBe(true);
		expect(mocks.dedicationChange).toHaveBeenCalledWith(
			expect.objectContaining({ id: 9, seferIds: [4] }),
		);
	});
});

describe("rescanDedicationExpiries", () => {
	it("flushes the scope invalidation for an expiry that elapsed while down", async () => {
		stubQueries({
			ids: [{ id: 9 }],
			state: [{ next_expiry: null, has_elapsed: 1 }],
			sefer: [{ dedication_id: 9, sefer_id: 4, expires_at: null }],
		});

		await rescanDedicationExpiries();

		expect(mocks.dedicationChange).toHaveBeenCalledWith(
			expect.objectContaining({ id: 9, seferIds: [4] }),
		);
		expect(mocks.revalidateWebsite).toHaveBeenCalled();
	});

	it("arms a wake-up at the earliest future expiry and fires it", async () => {
		// Only the arm clock is faked — setImmediate stays real so the
		// fire-and-forget sync chain can drain between assertions.
		vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
		let stateCalls = 0;
		stubQueries({ ids: [{ id: 9 }] });
		mocks.query.mockImplementation(async (sql: string) => {
			if (sql.startsWith("SELECT DISTINCT")) return [{ id: 9 }];
			if (sql.includes("MIN(CASE")) {
				stateCalls += 1;
				return stateCalls === 1
					? [{ next_expiry: "2030-01-01 00:00:00", has_elapsed: 0 }]
					: [{ next_expiry: null, has_elapsed: 1 }];
			}
			return [];
		});

		await rescanDedicationExpiries();
		expect(mocks.revalidateWebsite).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(
			Date.parse("2030-01-01T00:00:00.000Z") - Date.now() + 1000,
		);
		await flush();

		expect(mocks.dedicationChange).toHaveBeenCalledWith(
			expect.objectContaining({ id: 9 }),
		);
		expect(mocks.revalidateWebsite).toHaveBeenCalled();
	});

	it("re-derives state on update so a moved expiry re-arms", async () => {
		mocks.queryOne.mockResolvedValue({ id: 9 });
		stubQueries({
			state: [{ next_expiry: "2030-01-01 00:00:00", has_elapsed: 0 }],
		});

		await updateDedication({
			data: {
				id: 9,
				subject: "y",
				purposeTypeIds: [],
				targets: [{ kind: "masora" }],
			},
		});
		await flush();

		const sqls = mocks.query.mock.calls.map(([sql]) => sql as string);
		expect(sqls.some((s) => s.includes("MIN(CASE"))).toBe(true);
	});
});
