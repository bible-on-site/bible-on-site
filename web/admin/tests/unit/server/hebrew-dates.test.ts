import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	execute: vi.fn(),
	txQuery: vi.fn(),
	txExecute: vi.fn(),
}));
vi.mock("~/server/db", () => ({
	query: mocks.query,
	execute: mocks.execute,
	txQuery: mocks.txQuery,
	txExecute: mocks.txExecute,
}));

import {
	assertHebrewDateArticleEligible,
	assertHebrewDatesAvailable,
	invalidateUnsentBulletinsForHebrewDates,
	isHebrewDateSchemaMissing,
	normalizeHebrewDates,
	replaceHebrewDates,
} from "~/server/hebrew-dates";

const conn = { marker: "conn" } as never;

describe("recurring-date article eligibility", () => {
	it.each([undefined, null, ""])(
		"rejects a distributable assignment owner without a body: %s",
		(content) => {
			expect(() =>
				assertHebrewDateArticleEligible(
					{ id: 7, distributable: true, content },
					[{ hebrew_month: 11, hebrew_day: 9 }],
				),
			).toThrow(/non-empty body of written content/);
		},
	);
});

describe("normalizeHebrewDates", () => {
	it("passes valid rows through", () => {
		expect(
			normalizeHebrewDates([
				{ hebrew_month: 11, hebrew_day: 9 },
				{ hebrew_month: 8, hebrew_day: 5 },
			]),
		).toEqual([
			{ hebrew_month: 11, hebrew_day: 9 },
			{ hebrew_month: 8, hebrew_day: 5 },
		]);
		expect(normalizeHebrewDates([])).toEqual([]);
	});

	it("rejects non-integer coordinates", () => {
		for (const row of [
			{ hebrew_month: 1.5, hebrew_day: 1 },
			{ hebrew_month: 1, hebrew_day: Number.NaN },
			{ hebrew_month: Number.POSITIVE_INFINITY, hebrew_day: 1 },
		]) {
			expect(() => normalizeHebrewDates([row])).toThrow(/integer/);
		}
	});

	it("rejects months outside the uniform 1-14 range", () => {
		for (const month of [0, 15, -1]) {
			expect(() =>
				normalizeHebrewDates([{ hebrew_month: month, hebrew_day: 1 }]),
			).toThrow(/between 1 and 14/);
		}
	});

	it.each([
		[6, 30], // Adar never reaches 30
		[14, 30], // Adar II never reaches 30
		[4, 30], // Tevet is always 29
		[8, 30], // Iyar is always 29
		[1, 31], // beyond any month
		[11, 0], // below any month
	])("rejects invalid month/day pair %s/%s", (hebrew_month, hebrew_day) => {
		expect(() =>
			normalizeHebrewDates([{ hebrew_month, hebrew_day }]),
		).toThrow();
	});

	it("allows day 30 only where the month can reach it", () => {
		expect(
			normalizeHebrewDates([
				{ hebrew_month: 3, hebrew_day: 30 }, // Kislev may be 30
				{ hebrew_month: 13, hebrew_day: 30 }, // Adar I is 30
				{ hebrew_month: 11, hebrew_day: 30 }, // Av is 30
			]),
		).toHaveLength(3);
	});

	it("rejects duplicate dates", () => {
		expect(() =>
			normalizeHebrewDates([
				{ hebrew_month: 11, hebrew_day: 9 },
				{ hebrew_month: 11, hebrew_day: 9 },
			]),
		).toThrow(/Duplicate/);
	});
});

describe("isHebrewDateSchemaMissing", () => {
	it("recognizes the MySQL missing-table signals", () => {
		expect(isHebrewDateSchemaMissing({ code: "ER_NO_SUCH_TABLE" })).toBe(true);
		expect(isHebrewDateSchemaMissing({ code: "ER_BAD_FIELD_ERROR" })).toBe(
			true,
		);
		expect(isHebrewDateSchemaMissing({ errno: 1146 })).toBe(true);
		expect(isHebrewDateSchemaMissing({ errno: 1054 })).toBe(true);
	});
	it("rejects other errors and non-errors", () => {
		expect(isHebrewDateSchemaMissing({ code: "ER_DUP_ENTRY" })).toBe(false);
		expect(isHebrewDateSchemaMissing(new Error("boom"))).toBe(false);
		expect(isHebrewDateSchemaMissing("nope")).toBe(false);
		expect(isHebrewDateSchemaMissing(null)).toBe(false);
	});
});

describe("assertHebrewDatesAvailable", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
	});

	it("skips the lookup entirely for an empty set", async () => {
		await assertHebrewDatesAvailable(conn, 7, []);
		expect(mocks.txQuery).not.toHaveBeenCalled();
	});

	it("passes when no other article holds the dates", async () => {
		mocks.txQuery.mockResolvedValue([]);
		await assertHebrewDatesAvailable(conn, 7, [
			{ hebrew_month: 11, hebrew_day: 9 },
		]);
		expect(mocks.txQuery).toHaveBeenCalledWith(
			conn,
			expect.stringContaining("tanah_article_hebrew_date"),
			[7, 11, 9],
		);
	});

	it("rejects dates another article already holds", async () => {
		mocks.txQuery.mockResolvedValue([{ article_id: 2860 }]);
		await expect(
			assertHebrewDatesAvailable(conn, 7, [{ hebrew_month: 8, hebrew_day: 5 }]),
		).rejects.toThrow(/already assigned to article 2860/);
	});
});

describe("replaceHebrewDates", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
	});

	it("always deletes existing rows and inserts the new set", async () => {
		await replaceHebrewDates(conn, 7, [
			{ hebrew_month: 11, hebrew_day: 9 },
			{ hebrew_month: 8, hebrew_day: 5 },
		]);
		expect(mocks.txExecute).toHaveBeenCalledTimes(2);
		expect(mocks.txExecute.mock.calls[0]).toEqual([
			conn,
			expect.stringContaining("DELETE FROM tanah_article_hebrew_date"),
			[7],
		]);
		expect(mocks.txExecute.mock.calls[1]).toEqual([
			conn,
			expect.stringContaining("INSERT INTO tanah_article_hebrew_date"),
			[7, 11, 9, 7, 8, 5],
		]);
	});

	it("leaves the article date-less without an insert for an empty set", async () => {
		await replaceHebrewDates(conn, 7, []);
		expect(mocks.txExecute).toHaveBeenCalledTimes(1);
		expect(mocks.txExecute.mock.calls[0][1]).toContain("DELETE");
	});
});

describe("invalidateUnsentBulletinsForHebrewDates", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
	});

	it("does nothing for an empty set", async () => {
		await invalidateUnsentBulletinsForHebrewDates([]);
		expect(mocks.query).not.toHaveBeenCalled();
	});

	it("deletes a prepared bulletin whose date matches and is fully pending", async () => {
		// 9 Av 5784 = 2024-08-13; 5 Iyar 5785 = 2025-05-03.
		mocks.query
			.mockResolvedValueOnce([{ bulletin_date: "2024-08-13" }])
			.mockResolvedValueOnce([{ status: "pending" }, { status: "pending" }]);
		await invalidateUnsentBulletinsForHebrewDates([
			{ hebrew_month: 11, hebrew_day: 9 },
		]);
		expect(mocks.execute).toHaveBeenCalledTimes(2);
		expect(mocks.execute.mock.calls[0][0]).toContain(
			"DELETE FROM tanah_daily_bulletin_delivery",
		);
		expect(mocks.execute.mock.calls[1][0]).toContain(
			"DELETE FROM tanah_daily_bulletin",
		);
		expect(mocks.execute.mock.calls[1][1]).toEqual(["2024-08-13"]);
	});

	it("keeps prepared bulletins with a sent or non-pending delivery", async () => {
		mocks.query
			.mockResolvedValueOnce([{ bulletin_date: "2024-08-13" }])
			.mockResolvedValueOnce([{ status: "pending" }, { status: "sent" }]);
		await invalidateUnsentBulletinsForHebrewDates([
			{ hebrew_month: 11, hebrew_day: 9 },
		]);
		expect(mocks.execute).not.toHaveBeenCalled();
	});

	it("keeps prepared bulletins for unrelated Hebrew dates", async () => {
		mocks.query.mockResolvedValueOnce([{ bulletin_date: "2024-08-13" }]);
		await invalidateUnsentBulletinsForHebrewDates([
			{ hebrew_month: 8, hebrew_day: 5 }, // 5 Iyar — not 9 Av
		]);
		expect(mocks.execute).not.toHaveBeenCalled();
		expect(mocks.query).toHaveBeenCalledTimes(1);
	});

	it("swallows a missing-schema error silently", async () => {
		mocks.query.mockRejectedValue({ code: "ER_NO_SUCH_TABLE" });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await invalidateUnsentBulletinsForHebrewDates([
			{ hebrew_month: 11, hebrew_day: 9 },
		]);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("warns but does not throw on other failures", async () => {
		mocks.query.mockRejectedValue(new Error("connection lost"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await invalidateUnsentBulletinsForHebrewDates([
			{ hebrew_month: 11, hebrew_day: 9 },
		]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("invalidate unsent bulletins"),
			"connection lost",
		);
		warn.mockRestore();
	});

	it("warns with the raw value when the failure is not an Error", async () => {
		mocks.query.mockRejectedValue("dropped connection");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await invalidateUnsentBulletinsForHebrewDates([
			{ hebrew_month: 11, hebrew_day: 9 },
		]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("invalidate unsent bulletins"),
			"dropped connection",
		);
		warn.mockRestore();
	});
});
