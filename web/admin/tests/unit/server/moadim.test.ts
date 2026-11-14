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
vi.mock("@tanstack/react-start/server-only", () => ({}));
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
	getMoed,
	listMoadim,
	normalizeMoedSlug,
	upsertMoed,
} from "~/server/moadim";
import {
	loadArticleMoedIds,
	txReplaceArticleMoadim,
} from "~/server/moadim-links.server";

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

describe("listMoadim", () => {
	it("maps catalogue rows, counts and the draft flag", async () => {
		mocks.query.mockResolvedValueOnce([
			{
				id: 1,
				slug: "פסח",
				name: "פסח",
				summary: "חג",
				hebrew_month: "ניסן",
				date_label: "טו-כב בניסן",
				annual_order: 3,
				published: 1,
				section_count: 2,
				range_count: 4,
				article_count: 7,
			},
			{
				id: 2,
				slug: "דין",
				name: "דין",
				summary: null,
				hebrew_month: null,
				date_label: null,
				annual_order: 5,
				published: 0,
				section_count: 0,
				range_count: 0,
				article_count: 0,
			},
		]);
		const rows = await listMoadim();
		expect(rows).toEqual([
			{
				id: 1,
				slug: "פסח",
				name: "פסח",
				summary: "חג",
				hebrewMonth: "ניסן",
				dateLabel: "טו-כב בניסן",
				annualOrder: 3,
				published: true,
				sectionCount: 2,
				rangeCount: 4,
				articleCount: 7,
			},
			{
				id: 2,
				slug: "דין",
				name: "דין",
				summary: null,
				hebrewMonth: null,
				dateLabel: null,
				annualOrder: 5,
				published: false,
				sectionCount: 0,
				rangeCount: 0,
				articleCount: 0,
			},
		]);
	});

	it("returns undefined while the moed schema is not deployed", async () => {
		mocks.query.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" });
		await expect(listMoadim()).resolves.toBeUndefined();
	});

	it("rethrows errors that are not the missing schema", async () => {
		mocks.query.mockRejectedValueOnce(new Error("connection lost"));
		await expect(listMoadim()).rejects.toThrow("connection lost");
	});
});

describe("getMoed", () => {
	it("returns null when the moed does not exist", async () => {
		mocks.queryOne.mockResolvedValueOnce(null);
		await expect(getMoed({ data: 99 })).resolves.toBeNull();
		expect(mocks.query).not.toHaveBeenCalled();
	});

	it("loads the full editor payload with sections, ranges and links", async () => {
		mocks.queryOne.mockResolvedValueOnce({
			id: 7,
			slug: "פסח",
			name: "פסח",
			summary: "חג",
			hebrew_month: "ניסן",
			date_label: null,
			annual_order: 3,
			published: 0,
		});
		mocks.query
			.mockResolvedValueOnce([
				{ id: 1, label: "א", position: 1 },
				{ id: 2, label: "ב", position: 2 },
			])
			.mockResolvedValueOnce([
				{
					id: 11,
					section_id: 1,
					position: 1,
					perek_id_start: 470,
					pasuk_start: 1,
					perek_id_end: 470,
					pasuk_end: 10,
				},
				{
					id: 12,
					section_id: 2,
					position: 1,
					perek_id_start: 500,
					pasuk_start: 3,
					perek_id_end: 501,
					pasuk_end: 2,
				},
			])
			.mockResolvedValueOnce([{ article_id: 9 }, { article_id: 4 }]);
		const detail = await getMoed({ data: 7 });
		expect(detail).toEqual({
			id: 7,
			slug: "פסח",
			name: "פסח",
			summary: "חג",
			hebrewMonth: "ניסן",
			dateLabel: null,
			annualOrder: 3,
			published: false,
			sections: [
				{
					id: 1,
					label: "א",
					ranges: [
						{
							perekIdStart: 470,
							pasukStart: 1,
							perekIdEnd: 470,
							pasukEnd: 10,
						},
					],
				},
				{
					id: 2,
					label: "ב",
					ranges: [
						{
							perekIdStart: 500,
							pasukStart: 3,
							perekIdEnd: 501,
							pasukEnd: 2,
						},
					],
				},
			],
			articleIds: [9, 4],
		});
	});

	it("skips the range join when the moed has no sections", async () => {
		mocks.queryOne.mockResolvedValueOnce({
			id: 7,
			slug: "פסח",
			name: "פסח",
			summary: null,
			hebrew_month: null,
			date_label: null,
			annual_order: 3,
			published: 1,
		});
		mocks.query
			.mockResolvedValueOnce([]) // sections
			.mockResolvedValueOnce([]); // article links
		const detail = await getMoed({ data: 7 });
		expect(detail?.sections).toEqual([]);
		// sections + article-links queries — never the ranges join.
		expect(mocks.query).toHaveBeenCalledTimes(2);
	});
});

describe("upsertMoed", () => {
	const baseSection = {
		label: "תורה",
		ranges: [{ perekIdStart: 1, pasukStart: 1, perekIdEnd: 1, pasukEnd: 3 }],
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

	it("rejects a blank name, a non-positive order and bad section shapes", async () => {
		// An explicit valid slug lets the blank name reach the name check
		// (an omitted slug is derived from the name and fails earlier).
		await expect(
			upsertMoed({
				data: { name: "   ", slug: "x", annualOrder: 1, published: true },
			}),
		).rejects.toThrow(/חובה/);
		await expect(
			upsertMoed({
				data: { name: "מועד", annualOrder: 0, published: true },
			}),
		).rejects.toThrow(/annualOrder/);
		await expect(
			upsertMoed({
				data: {
					name: "מועד",
					annualOrder: 1,
					published: true,
					sections: [{ label: "  ", ranges: [baseSection.ranges[0]] }],
				},
			}),
		).rejects.toThrow(/תווית/);
		await expect(
			upsertMoed({
				data: {
					name: "מועד",
					annualOrder: 1,
					published: true,
					sections: [{ label: "תורה", ranges: [] }],
				},
			}),
		).rejects.toThrow(/טווח אחד/);
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("rejects a duplicate slug or annual order in the same transaction", async () => {
		mocks.txQuery.mockResolvedValueOnce([{ id: 7, slug: "פסח" }]);
		await expect(
			upsertMoed({
				data: { name: "פסח", annualOrder: 1, published: true },
			}),
		).rejects.toThrow(/הסלאג.*כבר בשימוש/);

		mocks.txQuery.mockResolvedValueOnce([{ id: 7, slug: "אחר" }]);
		await expect(
			upsertMoed({
				data: { name: "פסח", annualOrder: 1, published: true },
			}),
		).rejects.toThrow(/annualOrder 1 כבר בשימוש במועד 7/);
		expect(mocks.revalidateWebsite).not.toHaveBeenCalled();
	});

	it("rejects an unknown perek and a missing canonical bound", async () => {
		mocks.txQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]); // no perek rows at all
		await expect(
			upsertMoed({
				data: {
					name: "מועד",
					annualOrder: 15,
					published: true,
					sections: [baseSection],
				},
			}),
		).rejects.toThrow(/פרק 1 לא קיים/);

		mocks.txQuery
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ id: 1, pasuk_count: null }]);
		await expect(
			upsertMoed({
				data: {
					name: "מועד",
					annualOrder: 15,
					published: true,
					sections: [baseSection],
				},
			}),
		).rejects.toThrow(/חסר מספר פסוקים/);
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
			writes.some((sql) => sql.includes("DELETE FROM tanah_moed_section")),
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
				changes: [{ kind: "moed", id: 3, slug: "סוכות", oldSlug: "סוכות" }],
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
		await expect(txReplaceArticleMoadim(conn, 1, [2, 2])).rejects.toThrow(
			/כפול/,
		);
		mocks.txQuery.mockResolvedValueOnce([{ id: 4 }]); // existence check
		await expect(txReplaceArticleMoadim(conn, 1, [4, 5])).rejects.toThrow(
			/מועד 5/,
		);
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
		await expect(txReplaceArticleMoadim(conn, 1, [3])).resolves.toBeNull();
		expect(mocks.txExecute).not.toHaveBeenCalled();
	});
});
