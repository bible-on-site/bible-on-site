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
	rescanDedicationExpiries,
} from "~/server/dedication-expiry";
import {
	createDedication,
	deleteDedication,
	getDedication,
	listDedications,
	normalizeExpiry,
	previewDedicationLine,
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
});

describe("previewDedicationLine", () => {
	it("mirrors the website's formatDedication output", () => {
		expect(previewDedicationLine("מרדכי", [])).toBe("מוקדש למרדכי");
		expect(previewDedicationLine("מרדכי", ['לע"נ', " "])).toBe(
			'מוקדש למרדכי (לע"נ)',
		);
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
			dedication: [
				{ id: 9, subject: "ראובן", expires_at: null, expired: 0 },
			],
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
			dedication: [
				{ id: 5, subject: "x", expires_at: null, expired: 1 },
			],
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
		expect(
			written.some((s) => s.includes("INTO tanah_sefer_dedication")),
		).toBe(true);
		expect(
			written.some((s) =>
				s.includes("INTO tanah_dedication_dedication_type"),
			),
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
		expect(written.some((s) => s.includes("DELETE FROM tanah_dedication"))).toBe(
			true,
		);
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
