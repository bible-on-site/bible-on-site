import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const conn = { marker: "tx-conn" };
	return {
		conn,
		query: vi.fn(),
		queryOne: vi.fn(),
		txQuery: vi.fn(),
		txQueryOne: vi.fn(),
		txExecute: vi.fn(),
		transaction: vi.fn(async (fn: (c: unknown) => unknown) => fn(conn)),
		revalidateWebsite: vi.fn(),
	};
});

vi.mock("@tanstack/react-start", () => ({
	createServerOnlyFn: (fn: unknown) => fn,
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
}));

vi.mock("~/server/db", () => ({
	query: mocks.query,
	queryOne: mocks.queryOne,
	transaction: mocks.transaction,
	txQuery: mocks.txQuery,
	txQueryOne: mocks.txQueryOne,
	txExecute: mocks.txExecute,
}));

vi.mock("~/server/website-revalidate", () => ({
	pediaEntryPath: (name: string) => `/pedia/${name}`,
	pediaInvalidation: (...urls: string[]) => ({ kind: "pedia", urls }),
	revalidateWebsite: mocks.revalidateWebsite,
}));

import type mysql from "mysql2/promise";
import {
	dropSelfShadowedAliasInTx,
	keepOldNameAsAliasInTx,
} from "~/server/tanahpedia/alias-ops.server";
import {
	checkPediaName,
	deleteAliasName,
	getEntryAliases,
	removeEntryFromAlias,
	saveEntryAlias,
} from "~/server/tanahpedia/aliases";

const CONN = mocks.conn as unknown as mysql.PoolConnection;

function resetMocks() {
	for (const mock of [
		mocks.query,
		mocks.queryOne,
		mocks.txQuery,
		mocks.txQueryOne,
		mocks.txExecute,
		mocks.transaction,
		mocks.revalidateWebsite,
	])
		mock.mockReset();
}

const ENTRY_A = { entryId: "e-a", uniqueName: "משה-רבנו", title: "משה רבנו" };
const ENTRY_B = { entryId: "e-b", uniqueName: "משה-החוטם", title: "משה החוטם" };

/** The union query that loads a name's targets — matched by its UNION shape. */
function isTargetsSql(sql: string): boolean {
	return sql.includes("UNION") && sql.includes("tanahpedia_entry_synonym");
}

function synonymInserts() {
	return mocks.txExecute.mock.calls.filter((c) =>
		String(c[1]).includes("INSERT INTO tanahpedia_entry_synonym ("),
	);
}

function labelInserts() {
	return mocks.txExecute.mock.calls.filter((c) =>
		String(c[1]).includes(
			"INSERT INTO tanahpedia_entry_synonym_disambiguation",
		),
	);
}

describe("getEntryAliases", () => {
	beforeEach(() => {
		resetMocks();
		mocks.transaction.mockImplementation(async (fn) => fn(CONN));
	});

	it("classifies a single-target name as a plain alias", async () => {
		mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
			const s = String(sql);
			if (s.includes("SELECT DISTINCT name FROM")) return [{ name: "משה" }];
			if (isTargetsSql(s) && params?.[0] === "משה")
				return [{ ...ENTRY_A, label: null }];
			return [];
		});
		mocks.queryOne.mockResolvedValue(null);

		const views = await getEntryAliases({ data: "e-a" });
		expect(views).toHaveLength(1);
		expect(views[0]).toMatchObject({
			name: "משה",
			kind: "alias",
			shadowedByCanonical: null,
			isSelfMain: false,
			reservedCategory: null,
		});
	});

	it("classifies a shared name as a disambiguation page with all targets", async () => {
		mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
			const s = String(sql);
			if (s.includes("SELECT DISTINCT name FROM")) return [{ name: "משה" }];
			if (isTargetsSql(s) && params?.[0] === "משה")
				return [
					{ ...ENTRY_A, label: "הנביא" },
					{ ...ENTRY_B, label: "החוטם" },
				];
			return [];
		});
		mocks.queryOne.mockResolvedValue(null);

		const [view] = await getEntryAliases({ data: "e-a" });
		expect(view.kind).toBe("disambiguation");
		expect(view.targets).toHaveLength(2);
		expect(view.targets.map((t) => t.label)).toEqual(["הנביא", "החוטם"]);
	});

	it("marks a name shadowed by another entry's main URL", async () => {
		mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
			const s = String(sql);
			if (s.includes("SELECT DISTINCT name FROM")) return [{ name: "משה" }];
			if (isTargetsSql(s) && params?.[0] === "משה")
				return [{ ...ENTRY_A, label: null }];
			return [];
		});
		mocks.queryOne.mockResolvedValue({
			id: "e-b",
			unique_name: "משה",
			title: "משה אחר",
		});

		const [view] = await getEntryAliases({ data: "e-a" });
		expect(view.shadowedByCanonical).toEqual({
			entryId: "e-b",
			uniqueName: "משה",
			title: "משה אחר",
		});
	});

	it("marks a name equal to the entry's own main URL", async () => {
		mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
			const s = String(sql);
			if (s.includes("SELECT DISTINCT name FROM")) return [{ name: "משה" }];
			if (isTargetsSql(s) && params?.[0] === "משה")
				return [{ ...ENTRY_A, label: null }];
			return [];
		});
		mocks.queryOne.mockResolvedValue({
			id: "e-a",
			unique_name: "משה",
			title: "משה רבנו",
		});

		const [view] = await getEntryAliases({ data: "e-a" });
		expect(view.isSelfMain).toBe(true);
		expect(view.shadowedByCanonical).toBeNull();
	});

	it("dedupes a target that appears in both row kinds, preferring its label", async () => {
		mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
			const s = String(sql);
			if (s.includes("SELECT DISTINCT name FROM")) return [{ name: "משה" }];
			if (isTargetsSql(s) && params?.[0] === "משה")
				return [
					{ ...ENTRY_A, label: null },
					{ ...ENTRY_A, label: "הנביא" },
					{ ...ENTRY_B, label: "החוטם" },
				];
			return [];
		});
		mocks.queryOne.mockResolvedValue(null);

		const [view] = await getEntryAliases({ data: "e-a" });
		expect(view.targets).toHaveLength(2);
		const a = view.targets.find((t) => t.entryId === "e-a");
		expect(a?.label).toBe("הנביא");
	});

	it("keeps the first labelled row when a duplicate brings no label", async () => {
		mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
			const s = String(sql);
			if (s.includes("SELECT DISTINCT name FROM")) return [{ name: "משה" }];
			if (isTargetsSql(s) && params?.[0] === "משה")
				return [
					{ ...ENTRY_A, label: "הנביא" },
					{ ...ENTRY_A, label: null },
				];
			return [];
		});
		mocks.queryOne.mockResolvedValue(null);

		const [view] = await getEntryAliases({ data: "e-a" });
		expect(view.targets).toHaveLength(1);
		expect(view.targets[0]?.label).toBe("הנביא");
	});
});

describe("checkPediaName", () => {
	beforeEach(() => {
		resetMocks();
		mocks.transaction.mockImplementation(async (fn) => fn(CONN));
	});

	it("reports an empty name as invalid", async () => {
		expect(await checkPediaName({ data: { name: "   " } })).toEqual(
			expect.objectContaining({ kind: "invalid" }),
		);
	});

	it("reports a name containing a path separator as invalid", async () => {
		expect(await checkPediaName({ data: { name: "א/ב" } })).toEqual(
			expect.objectContaining({ kind: "invalid" }),
		);
	});

	it("reports an over-long name as invalid", async () => {
		expect(await checkPediaName({ data: { name: "א".repeat(256) } })).toEqual(
			expect.objectContaining({ kind: "invalid" }),
		);
	});

	it("reports a missing name as invalid", async () => {
		expect(await checkPediaName({ data: {} as { name: string } })).toEqual(
			expect.objectContaining({ kind: "invalid" }),
		);
	});

	it("reports a category slug as reserved", async () => {
		expect(await checkPediaName({ data: { name: "אישים" } })).toEqual({
			kind: "reserved",
			name: "אישים",
			categoryLabel: "אישים",
		});
	});

	it("decodes a percent-encoded name before looking it up", async () => {
		mocks.queryOne.mockResolvedValue(null);
		mocks.query.mockResolvedValue([]);

		await checkPediaName({ data: { name: "%D7%9E%D7%A9%D7%94" } });

		expect(mocks.queryOne).toHaveBeenCalledWith(expect.any(String), ["משה"]);
	});

	it("reports a name held by another entry as canonical", async () => {
		mocks.queryOne.mockResolvedValue({
			id: "e-b",
			unique_name: "משה",
			title: "משה אחר",
		});
		mocks.query.mockResolvedValue([]);

		expect(
			await checkPediaName({
				data: { name: "משה", forEntryId: "e-a" },
			}),
		).toMatchObject({
			kind: "canonical",
			entry: { id: "e-b", title: "משה אחר" },
		});
	});

	it("reports the entry's own main URL as self-main", async () => {
		mocks.queryOne.mockResolvedValue({
			id: "e-a",
			unique_name: "משה",
			title: "משה רבנו",
		});
		mocks.query.mockResolvedValue([]);

		expect(
			await checkPediaName({
				data: { name: "משה", forEntryId: "e-a" },
			}),
		).toMatchObject({ kind: "self-main" });
	});

	it("reports an unclaimed but aliased name with its targets", async () => {
		mocks.queryOne.mockResolvedValue(null);
		mocks.query.mockResolvedValue([{ ...ENTRY_A, label: "הנביא" }]);

		expect(await checkPediaName({ data: { name: "משה" } })).toMatchObject({
			kind: "alias",
			targets: [{ entryId: "e-a", label: "הנביא" }],
		});
	});

	it("reports an unused name as free", async () => {
		mocks.queryOne.mockResolvedValue(null);
		mocks.query.mockResolvedValue([]);

		expect(await checkPediaName({ data: { name: "שם-חדש" } })).toEqual({
			kind: "free",
			name: "שם-חדש",
		});
	});
});

describe("saveEntryAlias", () => {
	beforeEach(() => {
		resetMocks();
		mocks.transaction.mockImplementation(async (fn) => fn(CONN));
		mocks.txQuery.mockResolvedValue([]);
		mocks.txQueryOne.mockResolvedValue(null);
	});

	it("rejects an invalid spec before opening a transaction", async () => {
		await expect(
			saveEntryAlias({
				data: {
					name: "",
					targets: [{ entryId: "e-a" }],
					expectedTargets: [],
				},
			}),
		).rejects.toThrow("VALIDATION");
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("rejects a missing name and target list", async () => {
		await expect(
			saveEntryAlias({
				data: {} as {
					name: string;
					targets: { entryId: string }[];
					expectedTargets: { entryId: string }[];
				},
			}),
		).rejects.toThrow("VALIDATION");
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("rejects a shared name whose targets lack labels", async () => {
		await expect(
			saveEntryAlias({
				data: {
					name: "משה",
					targets: [{ entryId: "e-a", label: "הנביא" }, { entryId: "e-b" }],
					expectedTargets: [],
				},
			}),
		).rejects.toThrow("VALIDATION");
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("rejects a reserved category name", async () => {
		await expect(
			saveEntryAlias({
				data: {
					name: "אישים",
					targets: [{ entryId: "e-a" }],
					expectedTargets: [],
				},
			}),
		).rejects.toThrow("VALIDATION");
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("rejects a name that is another entry's main URL inside the transaction", async () => {
		mocks.txQueryOne.mockResolvedValue({ id: "e-b", title: "משה אחר" });

		await expect(
			saveEntryAlias({
				data: {
					name: "משה",
					targets: [{ entryId: "e-a" }],
					expectedTargets: [],
				},
			}),
		).rejects.toThrow("VALIDATION");
		expect(mocks.txExecute).not.toHaveBeenCalledWith(
			mocks.conn,
			expect.stringContaining("DELETE FROM tanahpedia_entry_synonym"),
			expect.anything(),
		);
		expect(mocks.revalidateWebsite).not.toHaveBeenCalled();
	});

	it("rejects a spec referencing a missing target entry", async () => {
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (String(sql).includes("WHERE id IN")) return [{ id: "e-a" }];
			return [];
		});

		await expect(
			saveEntryAlias({
				data: {
					name: "משה",
					targets: [
						{ entryId: "e-a", label: "א" },
						{ entryId: "ghost", label: "ב" },
					],
					expectedTargets: [],
				},
			}),
		).rejects.toThrow("VALIDATION");
	});

	it("writes a single-target alias with no label rows", async () => {
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (String(sql).includes("WHERE id IN")) return [{ id: "e-a" }];
			return [];
		});

		const result = await saveEntryAlias({
			data: {
				name: "משה",
				targets: [{ entryId: "e-a" }],
				expectedTargets: [],
			},
		});

		expect(result).toEqual({ name: "משה", targetCount: 1, kind: "alias" });
		expect(synonymInserts()).toHaveLength(1);
		expect(synonymInserts()[0]?.[2]?.slice(1)).toEqual(["משה", "e-a"]);
		expect(labelInserts()).toHaveLength(0);
	});

	it("writes a shared name as one synonym row plus one label row per target", async () => {
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (String(sql).includes("WHERE id IN"))
				return [{ id: "e-a" }, { id: "e-b" }];
			return [];
		});

		const result = await saveEntryAlias({
			data: {
				name: "משה",
				targets: [
					{ entryId: "e-a", label: "הנביא" },
					{ entryId: "e-b", label: "החוטם" },
				],
				expectedTargets: [],
			},
		});

		expect(result).toEqual({
			name: "משה",
			targetCount: 2,
			kind: "disambiguation",
		});
		expect(synonymInserts()).toHaveLength(2);
		expect(labelInserts()).toHaveLength(2);
		// Each label row carries its target's entry_id + distinguishing label:
		// (id, synonym_id, entry_id, disambiguation_label).
		const labelParams = labelInserts().map((c) => (c[2] as string[]).slice(2));
		expect(labelParams).toEqual([
			["e-a", "הנביא"],
			["e-b", "החוטם"],
		]);
	});

	it("replaces the previous rows inside the same transaction", async () => {
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (String(sql).includes("WHERE id IN")) return [{ id: "e-a" }];
			return [];
		});

		await saveEntryAlias({
			data: {
				name: "משה",
				targets: [{ entryId: "e-a" }],
				expectedTargets: [],
			},
		});

		const calls = mocks.txExecute.mock.calls.map((c) => String(c[1]));
		const deleteIdx = calls.findIndex((s) =>
			s.includes("DELETE FROM tanahpedia_entry_synonym WHERE name = ?"),
		);
		const firstInsert = calls.findIndex((s) =>
			s.includes("INSERT INTO tanahpedia_entry_synonym"),
		);
		expect(deleteIdx).toBeGreaterThanOrEqual(0);
		expect(firstInsert).toBeGreaterThan(deleteIdx);
	});

	it("dedupes repeated target ids before writing", async () => {
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (String(sql).includes("WHERE id IN")) return [{ id: "e-a" }];
			return [];
		});

		const result = await saveEntryAlias({
			data: {
				name: "משה",
				targets: [{ entryId: "e-a" }, { entryId: "e-a", label: "הנביא" }],
				expectedTargets: [],
			},
		});

		expect(result.targetCount).toBe(1);
		expect(synonymInserts()).toHaveLength(1);
	});

	it("notifies the website about the changed name after commit", async () => {
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (String(sql).includes("WHERE id IN")) return [{ id: "e-a" }];
			return [];
		});

		await saveEntryAlias({
			data: {
				name: "משה",
				targets: [{ entryId: "e-a" }],
				expectedTargets: [],
			},
		});

		expect(mocks.revalidateWebsite).toHaveBeenCalledWith({
			kind: "pedia",
			urls: ["/pedia/משה"],
		});
	});

	it("rejects the save when the name drifted from the editor's baseline", async () => {
		// The shared name gained a second target since the editor opened — a
		// blind replace would silently drop it.
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (isTargetsSql(String(sql)))
				return [
					{ ...ENTRY_A, label: "הנביא" },
					{ ...ENTRY_B, label: "החוטם" },
				];
			if (String(sql).includes("WHERE id IN")) return [{ id: "e-a" }];
			return [];
		});

		await expect(
			saveEntryAlias({
				data: {
					name: "משה",
					targets: [{ entryId: "e-a" }],
					expectedTargets: [{ entryId: "e-a", label: "הנביא" }],
				},
			}),
		).rejects.toThrow("REVISION_CONFLICT");
		expect(mocks.txExecute).not.toHaveBeenCalledWith(
			mocks.conn,
			expect.stringContaining("DELETE FROM tanahpedia_entry_synonym"),
			expect.anything(),
		);
		expect(mocks.revalidateWebsite).not.toHaveBeenCalled();
	});

	it("rejects a first save that arrived after another admin created the name", async () => {
		// Editor opened while the name was free (baseline: empty); the name now
		// has rows — the stale write must not clobber them.
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (isTargetsSql(String(sql))) return [{ ...ENTRY_B, label: null }];
			if (String(sql).includes("WHERE id IN")) return [{ id: "e-a" }];
			return [];
		});

		await expect(
			saveEntryAlias({
				data: {
					name: "משה",
					targets: [{ entryId: "e-a" }],
					expectedTargets: [],
				},
			}),
		).rejects.toThrow("REVISION_CONFLICT");
		expect(synonymInserts()).toHaveLength(0);
		expect(mocks.revalidateWebsite).not.toHaveBeenCalled();
	});

	it("replaces the set when the baseline matches the locked current rows", async () => {
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (isTargetsSql(String(sql)))
				return [
					{ ...ENTRY_A, label: "הנביא" },
					{ ...ENTRY_B, label: "החוטם" },
				];
			if (String(sql).includes("WHERE id IN"))
				return [{ id: "e-a" }, { id: "e-b" }];
			return [];
		});

		const result = await saveEntryAlias({
			data: {
				name: "משה",
				targets: [
					{ entryId: "e-a", label: "הנביא" },
					{ entryId: "e-b", label: "אותו אחד" },
				],
				expectedTargets: [
					{ entryId: "e-b", label: "החוטם" },
					{ entryId: "e-a", label: "הנביא" },
				],
			},
		});

		expect(result.targetCount).toBe(2);
		expect(synonymInserts()).toHaveLength(2);
	});
});

describe("removeEntryFromAlias", () => {
	beforeEach(() => {
		resetMocks();
		mocks.transaction.mockImplementation(async (fn) => fn(CONN));
		mocks.txQuery.mockResolvedValue([]);
	});

	it("rejects a missing name before opening a transaction", async () => {
		await expect(
			removeEntryFromAlias({
				data: { name: undefined as unknown as string, entryId: "e-a" },
			}),
		).rejects.toThrow("VALIDATION");
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("deletes only this entry's association", async () => {
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (isTargetsSql(String(sql))) return [{ ...ENTRY_B, label: "החוטם" }];
			return [];
		});

		const result = await removeEntryFromAlias({
			data: { name: "משה", entryId: "e-a" },
		});

		expect(result).toEqual({ name: "משה", remainingTargets: 1 });
		const ownDelete = mocks.txExecute.mock.calls.find(
			(c) =>
				String(c[1]).includes(
					"DELETE FROM tanahpedia_entry_synonym WHERE name = ? AND entry_id = ?",
				) && (c[2] as unknown[])[1] === "e-a",
		);
		expect(ownDelete).toBeTruthy();
	});

	it("drops leftover label rows when a single target remains", async () => {
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (isTargetsSql(String(sql))) return [{ ...ENTRY_B, label: "החוטם" }];
			return [];
		});

		await removeEntryFromAlias({ data: { name: "משה", entryId: "e-a" } });

		const labelCleanup = mocks.txExecute.mock.calls.filter(
			(c) =>
				String(c[1]).includes(
					"DELETE d FROM tanahpedia_entry_synonym_disambiguation",
				) && (c[2] as unknown[]).length === 1,
		);
		expect(labelCleanup).toHaveLength(1);
	});

	it("keeps label rows while the name is still shared", async () => {
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (isTargetsSql(String(sql)))
				return [
					{ ...ENTRY_B, label: "החוטם" },
					{
						entryId: "e-c",
						uniqueName: "משה-שלישי",
						title: "משה שלישי",
						label: "שלישי",
					},
				];
			return [];
		});

		const result = await removeEntryFromAlias({
			data: { name: "משה", entryId: "e-a" },
		});

		expect(result.remainingTargets).toBe(2);
		const labelCleanup = mocks.txExecute.mock.calls.filter(
			(c) =>
				String(c[1]).includes(
					"DELETE d FROM tanahpedia_entry_synonym_disambiguation",
				) && (c[2] as unknown[]).length === 1,
		);
		expect(labelCleanup).toHaveLength(0);
	});
});

describe("deleteAliasName", () => {
	beforeEach(() => {
		resetMocks();
		mocks.transaction.mockImplementation(async (fn) => fn(CONN));
	});

	it("rejects a missing name before opening a transaction", async () => {
		await expect(
			deleteAliasName({ data: { name: undefined as unknown as string } }),
		).rejects.toThrow("VALIDATION");
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("deletes every association of the name and reports the count", async () => {
		mocks.txQuery.mockImplementation(async (_c: unknown, sql: string) => {
			if (isTargetsSql(String(sql)))
				return [
					{ ...ENTRY_A, label: "א" },
					{ ...ENTRY_B, label: "ב" },
				];
			return [];
		});

		const result = await deleteAliasName({ data: { name: "משה" } });

		expect(result).toEqual({ name: "משה", removedTargets: 2 });
		const deleteCall = mocks.txExecute.mock.calls.find(
			(c) =>
				String(c[1]) === "DELETE FROM tanahpedia_entry_synonym WHERE name = ?",
		);
		expect(deleteCall?.[2]).toEqual(["משה"]);
		expect(mocks.revalidateWebsite).toHaveBeenCalledWith({
			kind: "pedia",
			urls: ["/pedia/משה"],
		});
	});
});

describe("rename helpers", () => {
	beforeEach(() => {
		resetMocks();
	});

	it("keepOldNameAsAliasInTx inserts the old name when it is free", async () => {
		mocks.txQuery.mockResolvedValue([]);

		const created = await keepOldNameAsAliasInTx(CONN, "e-a", "ישן");

		expect(created).toBe(true);
		const insert = synonymInserts()[0];
		expect(insert).toBeTruthy();
		expect(((insert?.[2] ?? []) as unknown[]).slice(1)).toEqual(["ישן", "e-a"]);
	});

	it("keepOldNameAsAliasInTx refuses an occupied old name", async () => {
		mocks.txQuery.mockResolvedValue([{ id: "row" }]);

		const created = await keepOldNameAsAliasInTx(CONN, "e-a", "משותף");

		expect(created).toBe(false);
		expect(synonymInserts()).toHaveLength(0);
	});

	it("keepOldNameAsAliasInTx refuses a reserved category slug", async () => {
		const created = await keepOldNameAsAliasInTx(CONN, "e-a", "אישים");

		expect(created).toBe(false);
		expect(mocks.txQuery).not.toHaveBeenCalled();
	});

	it("dropSelfShadowedAliasInTx removes only this entry's rows", async () => {
		await dropSelfShadowedAliasInTx(CONN, "e-a", "חדש");

		const calls = mocks.txExecute.mock.calls;
		expect(String(calls[0]?.[1])).toContain(
			"DELETE FROM tanahpedia_entry_synonym WHERE name = ? AND entry_id = ?",
		);
		expect(calls[0]?.[2]).toEqual(["חדש", "e-a"]);
		expect(String(calls[1]?.[1])).toContain(
			"DELETE d FROM tanahpedia_entry_synonym_disambiguation",
		);
		expect(calls[1]?.[2]).toEqual(["חדש", "e-a"]);
	});
});
