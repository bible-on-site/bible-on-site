import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const conn = { marker: "tx-conn" };
	return {
		conn,
		query: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(),
		queryOne: vi.fn(),
		txQuery: vi.fn(),
		txExecute: vi.fn<
			(
				conn: unknown,
				sql: string,
				params?: unknown[],
			) => Promise<{ insertId: number; affectedRows: number }>
		>(async () => ({ insertId: 42, affectedRows: 1 })),
		transaction: vi.fn(async (fn: (c: typeof conn) => unknown) => fn(conn)),
		revalidateWebsite: vi.fn(),
		moedChange: vi.fn((input: Record<string, unknown>) => ({
			changes: [{ kind: "moed", ...input }],
		})),
	};
});
vi.mock("~/server/db", () => ({
	query: mocks.query,
	queryOne: mocks.queryOne,
	transaction: mocks.transaction,
	txExecute: mocks.txExecute,
	txQuery: mocks.txQuery,
}));
vi.mock("~/server/website-revalidate", () => ({
	revalidateWebsite: mocks.revalidateWebsite,
	moedChange: mocks.moedChange,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				async (args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
}));

import {
	deleteMoed,
	loadArticleMoedIds,
	normalizeMoedSlug,
	txReplaceArticleMoadim,
	upsertMoed,
} from "~/server/moadim";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.query.mockResolvedValue([]);
	mocks.queryOne.mockResolvedValue(null);
	mocks.txQuery.mockResolvedValue([]);
	mocks.txExecute.mockResolvedValue({ insertId: 42, affectedRows: 1 });
});

describe("normalizeMoedSlug", () => {
	it("keeps Hebrew names with hyphens for spaces and strips quote marks", () => {
		expect(normalizeMoedSlug('ל"ג בעומר')).toBe("לג-בעומר");
		expect(normalizeMoedSlug("  יום  כיפור  ")).toBe("יום-כיפור");
	});

	it("rejects unsafe characters and hyphen edges", () => {
		expect(() => normalizeMoedSlug("פסח<script>")).toThrow(/סלאג/);
		expect(() => normalizeMoedSlug("-פסח")).toThrow(/סלאג/);
		expect(() => normalizeMoedSlug("פסח--חול")).toThrow(/סלאג/);
		expect(() => normalizeMoedSlug("   ")).toThrow(/סלאג/);
	});
});

describe("upsertMoed", () => {
	const baseSection = {
		label: "תורה",
		ranges: [
			{ perekIdStart: 1, pasukStart: 1, perekIdEnd: 1, pasukEnd: 3 },
		],
	};

	it("creates a moed with its sections atomically and revalidates", async () => {
		mocks.txQuery
			.mockResolvedValueOnce([]) // slug/order conflict check
			.mockResolvedValueOnce([{ id: 1, pasuk_count: 22 }]); // perek bound
		const result = await upsertMoed({
			data: {
				name: "מועד חדש",
				annualOrder: 15,
				published: true,
				sections: [baseSection],
			},
		});
		expect(result).toEqual({ id: 42, slug: "מועד-חדש" });
		const writes = mocks.txExecute.mock.calls.map((c) => String(c[1]));
		expect(writes.some((sql) => sql.includes("INSERT INTO tanah_moed "))).toBe(
			true,
		);
		expect(
			writes.some((sql) => sql.includes("INSERT INTO tanah_moed_section")),
		).toBe(true);
		expect(
			writes.some((sql) => sql.includes("INSERT INTO tanah_moed_range")),
		).toBe(true);
		expect(mocks.revalidateWebsite).toHaveBeenCalledWith([
			{ changes: [{ kind: "moed", id: 42, slug: "מועד-חדש" }] },
		]);
	});

	it("rejects a duplicate slug or annual order in the same transaction", async () => {
		mocks.txQuery.mockResolvedValueOnce([{ id: 7, slug: "פסח" }]);
		await expect(
			upsertMoed({
				data: { name: "פסח", annualOrder: 1, published: true },
			}),
		).rejects.toThrow(/כבר בשימוש/);
		expect(mocks.revalidateWebsite).not.toHaveBeenCalled();
	});

	it("rejects a range outside the canonical perek bounds", async () => {
		mocks.txQuery
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ id: 1, pasuk_count: 22 }]);
		await expect(
			upsertMoed({
				data: {
					name: "מועד",
					annualOrder: 15,
					published: true,
					sections: [
						{
							label: "תורה",
							ranges: [
								{
									perekIdStart: 1,
									pasukStart: 1,
									perekIdEnd: 1,
									pasukEnd: 99,
								},
							],
						},
					],
				},
			}),
		).rejects.toThrow(/מחוץ לתחום/);
	});

	it("rejects a range whose start comes after its end", async () => {
		mocks.txQuery
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ id: 1, pasuk_count: 22 }]);
		await expect(
			upsertMoed({
				data: {
					name: "מועד",
					annualOrder: 15,
					published: true,
					sections: [
						{
							label: "תורה",
							ranges: [
								{
									perekIdStart: 1,
									pasukStart: 5,
									perekIdEnd: 1,
									pasukEnd: 3,
								},
							],
						},
					],
				},
			}),
		).rejects.toThrow(/אחרי/);
	});

	it("carries the old slug on a rename so the stale route expires", async () => {
		mocks.txQuery
			.mockResolvedValueOnce([]) // conflict check
			.mockResolvedValueOnce([{ slug: "סוכות" }]) // FOR UPDATE previous slug
			.mockResolvedValueOnce([{ id: 1, pasuk_count: 22 }]);
		await upsertMoed({
			data: {
				id: 3,
				name: "סוכות",
				slug: "סוכות-חדש",
				annualOrder: 8,
				published: true,
				sections: [baseSection],
			},
		});
		expect(mocks.revalidateWebsite).toHaveBeenCalledWith([
			{
				changes: [
					{
						kind: "moed",
						id: 3,
						slug: "סוכות-חדש",
						oldSlug: "סוכות",
					},
				],
			},
		]);
	});

	it("leaves sections untouched when the field is omitted", async () => {
		mocks.txQuery
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ slug: "פסח" }]);
		await upsertMoed({
			data: {
				id: 1,
				name: "פסח",
				annualOrder: 1,
				published: true,
			},
		});
		const writes = mocks.txExecute.mock.calls.map((c) => String(c[1]));
		expect(
			writes.some((sql) =>
				sql.includes("DELETE FROM tanah_moed_section"),
			),
		).toBe(false);
	});
});

describe("deleteMoed", () => {
	it("deletes inside a transaction and expires both slug slots", async () => {
		mocks.txQuery.mockResolvedValueOnce([{ slug: "סוכות" }]);
		await expect(deleteMoed({ data: 3 })).resolves.toEqual({
			success: true,
		});
		expect(
			mocks.txExecute.mock.calls.some((c) =>
				String(c[1]).includes("DELETE FROM tanah_moed"),
			),
		).toBe(true);
		expect(mocks.revalidateWebsite).toHaveBeenCalledWith([
			{
				changes: [
					{ kind: "moed", id: 3, slug: "סוכות", oldSlug: "סוכות" },
				],
			},
		]);
	});

	it("rejects a missing moed without revalidating", async () => {
		mocks.txQuery.mockResolvedValueOnce([]);
		await expect(deleteMoed({ data: 9 })).rejects.toThrow(/not found/);
		expect(mocks.revalidateWebsite).not.toHaveBeenCalled();
	});
});

describe("article moed links", () => {
	const conn = mocks.conn as never;

	it("reports undefined while the moed schema is not deployed", async () => {
		mocks.query.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" });
		await expect(loadArticleMoedIds(7)).resolves.toBeUndefined();
	});

	it("returns the ordered link set when the schema is live", async () => {
		mocks.query.mockResolvedValueOnce([{ moed_id: 3 }, { moed_id: 9 }]);
		await expect(loadArticleMoedIds(7)).resolves.toEqual([3, 9]);
	});

	it("rejects duplicate and missing moed ids before any write", async () => {
		await expect(
			txReplaceArticleMoadim(conn, 1, [2, 2]),
		).rejects.toThrow(/כפול/);
		mocks.txQuery.mockResolvedValueOnce([{ id: 4 }]); // existence check
		await expect(
			txReplaceArticleMoadim(conn, 1, [4, 5]),
		).rejects.toThrow(/מועד 5/);
	});

	it("walks 0 -> 1 -> many -> 0 and returns the touched moed set", async () => {
		// 0 -> 1: no current links, insert moed 2.
		mocks.txQuery
			.mockResolvedValueOnce([{ id: 2 }]) // existence check
			.mockResolvedValueOnce([]) // current links
			.mockResolvedValueOnce([{ id: 2, slug: "שני" }]); // affected slugs
		let affected = await txReplaceArticleMoadim(conn, 1, [2]);
		expect(affected).toEqual([{ id: 2, slug: "שני" }]);
		expect(
			mocks.txExecute.mock.calls.some((c) =>
				String(c[1]).includes("INSERT INTO tanah_article_moed"),
			),
		).toBe(true);

		// 1 -> many: keep 2, add 5 — moed 5's slug is resolved for expiry.
		mocks.txExecute.mockClear();
		mocks.txQuery
			.mockResolvedValueOnce([{ id: 2 }, { id: 5 }])
			.mockResolvedValueOnce([{ id: 2, slug: "שני" }])
			.mockResolvedValueOnce([{ id: 5, slug: "חמישי" }]);
		affected = await txReplaceArticleMoadim(conn, 1, [2, 5]);
		expect(affected).toEqual([{ id: 5, slug: "חמישי" }]);
		const writes = mocks.txExecute.mock.calls.map((c) => String(c[1]));
		expect(writes.some((sql) => sql.includes("INSERT"))).toBe(true);
		expect(writes.some((sql) => sql.includes("DELETE"))).toBe(false);

		// many -> 0: clear everything — the removed moed expires.
		mocks.txExecute.mockClear();
		mocks.txQuery.mockResolvedValueOnce([
			{ id: 2, slug: "שני" },
			{ id: 5, slug: "חמישי" },
		]);
		affected = await txReplaceArticleMoadim(conn, 1, []);
		expect(affected).toEqual([
			{ id: 2, slug: "שני" },
			{ id: 5, slug: "חמישי" },
		]);
		expect(
			mocks.txExecute.mock.calls.some((c) =>
				String(c[1]).includes("DELETE FROM tanah_article_moed"),
			),
		).toBe(true);
	});

	it("returns null when the supplied set already matches the links", async () => {
		mocks.txQuery
			.mockResolvedValueOnce([{ id: 3 }])
			.mockResolvedValueOnce([{ id: 3, slug: "שלישי" }]);
		await expect(
			txReplaceArticleMoadim(conn, 1, [3]),
		).resolves.toBeNull();
		expect(mocks.txExecute).not.toHaveBeenCalled();
	});
});
