import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	txExecute: vi.fn(),
}));
vi.mock("~/server/db", () => mocks);

import {
	isReadingMetricsSchemaMissing,
	metricSourceHash,
	recomputeArticleMetrics,
	recomputeEntryMetrics,
} from "~/server/reading-metrics";

const conn = { marker: "tx" } as never;

describe("isReadingMetricsSchemaMissing", () => {
	it("recognizes missing-table and missing-column errors", () => {
		expect(isReadingMetricsSchemaMissing({ code: "ER_NO_SUCH_TABLE" })).toBe(
			true,
		);
		expect(isReadingMetricsSchemaMissing({ code: "ER_BAD_FIELD_ERROR" })).toBe(
			true,
		);
		expect(isReadingMetricsSchemaMissing({ errno: 1146 })).toBe(true);
		expect(isReadingMetricsSchemaMissing({ errno: 1054 })).toBe(true);
	});

	it("rejects unrelated errors and non-objects", () => {
		expect(isReadingMetricsSchemaMissing(new Error("x"))).toBe(false);
		expect(isReadingMetricsSchemaMissing(null)).toBe(false);
		expect(isReadingMetricsSchemaMissing({ code: "ER_DUP_ENTRY" })).toBe(false);
	});
});

describe("metricSourceHash", () => {
	it("is a stable sha256 hex", () => {
		expect(metricSourceHash("abc")).toMatch(/^[0-9a-f]{64}$/);
		expect(metricSourceHash("abc")).toBe(metricSourceHash("abc"));
		expect(metricSourceHash("abc")).not.toBe(metricSourceHash("abd"));
	});
});

describe("recomputeArticleMetrics", () => {
	beforeEach(() => mocks.txExecute.mockReset());

	it("upserts the metric row and replaces block rows", async () => {
		await recomputeArticleMetrics(conn, 7, "<p>אחת שתים</p><p>שלוש</p>");

		const calls = mocks.txExecute.mock.calls.map((c) => String(c[1]));
		expect(calls[0]).toContain("INSERT INTO tanah_article_metric");
		expect(calls[0]).toContain("ON DUPLICATE KEY UPDATE");
		// 3 words → ceil(3*60/220) = 1 second.
		expect(mocks.txExecute.mock.calls[0][2]).toEqual([
			7,
			3,
			1,
			220,
			1,
			expect.stringMatching(/^[0-9a-f]{64}$/),
		]);
		expect(calls[1]).toContain("DELETE FROM tanah_article_metric_block");
		const blockInserts = calls.filter((s) =>
			s.includes("INSERT INTO tanah_article_metric_block"),
		);
		expect(blockInserts).toHaveLength(2);
		// cumulative words: 2 then 3.
		expect(mocks.txExecute.mock.calls[2][2]).toEqual([7, 0, 2, 2, 1]);
		expect(mocks.txExecute.mock.calls[3][2]).toEqual([7, 1, 1, 3, 1]);
	});

	it("stores a verified-empty metric for empty content", async () => {
		await recomputeArticleMetrics(conn, 8, null);
		expect(mocks.txExecute.mock.calls[0][2]).toEqual([
			8,
			0,
			0,
			220,
			1,
			expect.stringMatching(/^[0-9a-f]{64}$/),
		]);
	});

	it("degrades silently when the schema is not deployed", async () => {
		mocks.txExecute.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" });
		await expect(
			recomputeArticleMetrics(conn, 9, "<p>x</p>"),
		).resolves.toBeUndefined();
	});

	it("propagates real write failures", async () => {
		mocks.txExecute.mockRejectedValueOnce(new Error("connection lost"));
		await expect(recomputeArticleMetrics(conn, 9, "<p>x</p>")).rejects.toThrow(
			"connection lost",
		);
	});
});

describe("recomputeEntryMetrics", () => {
	beforeEach(() => mocks.txExecute.mockReset());

	it("writes entry metric + blocks under the entry key", async () => {
		await recomputeEntryMetrics(conn, "entry-uuid", "<p>אחת</p>");
		const calls = mocks.txExecute.mock.calls.map((c) => String(c[1]));
		expect(calls[0]).toContain("INSERT INTO tanahpedia_entry_metric");
		expect(mocks.txExecute.mock.calls[0][2]?.[0]).toBe("entry-uuid");
		expect(calls[1]).toContain("DELETE FROM tanahpedia_entry_metric_block");
	});
});
