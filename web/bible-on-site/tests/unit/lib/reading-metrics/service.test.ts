/**
 * Unit tests for the reading-metrics service (#2607): stored-metric reads
 * and missing-schema degradation.
 */
jest.mock("../../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../../src/lib/api-client";
import {
	getArticleMetrics,
	getEntryMetric,
	getPerekMetric,
	getPerushMetric,
	getPerushMetricsByPerekId,
	isReadingMetricsSchemaMissing,
	metricOrFallback,
} from "../../../../src/lib/reading-metrics";

const mockQuery = query as jest.MockedFunction<typeof query>;

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
		expect(isReadingMetricsSchemaMissing(new Error("down"))).toBe(false);
		expect(isReadingMetricsSchemaMissing(null)).toBe(false);
		expect(isReadingMetricsSchemaMissing({ code: "ER_DUP_ENTRY" })).toBe(false);
	});
});

describe("getPerekMetric", () => {
	beforeEach(() => jest.clearAllMocks());

	it("maps the stored row", async () => {
		mockQuery.mockResolvedValueOnce([
			{ word_count: 361, estimated_seconds: 99 },
		] as never);
		expect(await getPerekMetric(1)).toEqual({
			wordCount: 361,
			estimatedSeconds: 99,
		});
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("tanah_perek_metric"),
			[1],
		);
	});

	it("returns null when no row exists", async () => {
		mockQuery.mockResolvedValueOnce([] as never);
		expect(await getPerekMetric(1)).toBeNull();
	});

	it("returns null when the schema is not deployed", async () => {
		mockQuery.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" } as never);
		expect(await getPerekMetric(1)).toBeNull();
	});

	it("propagates real database failures", async () => {
		mockQuery.mockRejectedValueOnce(new Error("conn lost") as never);
		await expect(getPerekMetric(1)).rejects.toThrow("conn lost");
	});
});

describe("article metrics", () => {
	beforeEach(() => jest.clearAllMocks());

	it("getArticleMetrics keys rows by article id", async () => {
		mockQuery.mockResolvedValueOnce([
			{ article_id: 7, word_count: 10, estimated_seconds: 3 },
		] as never);
		const map = await getArticleMetrics([7, 8]);
		expect(map.get(7)).toEqual({ wordCount: 10, estimatedSeconds: 3 });
		expect(map.has(8)).toBe(false);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("tanah_article_metric"),
			[7, 8],
		);
	});

	it("getArticleMetrics returns an empty map for no ids", async () => {
		expect((await getArticleMetrics([])).size).toBe(0);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it("getArticleMetrics degrades to an empty map on missing schema", async () => {
		mockQuery.mockRejectedValueOnce({ errno: 1146 } as never);
		expect((await getArticleMetrics([1, 2])).size).toBe(0);
	});
});

describe("perush metrics", () => {
	beforeEach(() => jest.clearAllMocks());

	it("getPerushMetricsByPerekId keys by perush id", async () => {
		mockQuery.mockResolvedValueOnce([
			{ perush_id: 3, word_count: 50, estimated_seconds: 14 },
		] as never);
		const map = await getPerushMetricsByPerekId(1);
		expect(map.get(3)).toEqual({ wordCount: 50, estimatedSeconds: 14 });
	});

	it("getPerushMetricsByPerekId degrades to an empty map", async () => {
		mockQuery.mockRejectedValueOnce({ errno: 1146 } as never);
		expect((await getPerushMetricsByPerekId(1)).size).toBe(0);
	});

	it("getPerushMetric binds perush and perek", async () => {
		mockQuery.mockResolvedValueOnce([
			{ word_count: 50, estimated_seconds: 14 },
		] as never);
		expect(await getPerushMetric(3, 1)).toEqual({
			wordCount: 50,
			estimatedSeconds: 14,
		});
		expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [3, 1]);
	});

	it("getPerushMetric returns null without a row", async () => {
		mockQuery.mockResolvedValueOnce([] as never);
		expect(await getPerushMetric(3, 1)).toBeNull();
	});
});

describe("getEntryMetric", () => {
	beforeEach(() => jest.clearAllMocks());

	it("maps the row and binds the entry id", async () => {
		mockQuery.mockResolvedValueOnce([
			{ word_count: 181, estimated_seconds: 50 },
		] as never);
		expect(await getEntryMetric("uuid-1")).toEqual({
			wordCount: 181,
			estimatedSeconds: 50,
		});
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("tanahpedia_entry_metric"),
			["uuid-1"],
		);
	});

	it("returns null without a row or on missing schema", async () => {
		mockQuery.mockResolvedValueOnce([] as never);
		expect(await getEntryMetric("uuid-1")).toBeNull();
		mockQuery.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" } as never);
		expect(await getEntryMetric("uuid-1")).toBeNull();
	});

	it("propagates real failures", async () => {
		mockQuery.mockRejectedValueOnce(new Error("down") as never);
		await expect(getEntryMetric("uuid-1")).rejects.toThrow("down");
	});
});

describe("metricOrFallback", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	it("returns the read result without warning", async () => {
		expect(await metricOrFallback("x", 0, () => Promise.resolve(7))).toBe(7);
		expect(console.warn).not.toHaveBeenCalled();
	});

	it("logs and yields the fallback when the read rejects", async () => {
		expect(
			await metricOrFallback("perushim perek 1", 0, () =>
				Promise.reject(new Error("metric timeout")),
			),
		).toBe(0);
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining("Reading metric read failed"),
			"perushim perek 1",
			"metric timeout",
		);
	});

	it("passes through non-Error rejections in the warning", async () => {
		expect(
			await metricOrFallback("x", [], () => Promise.reject("raw")),
		).toEqual([]);
		expect(console.warn).toHaveBeenCalledWith(expect.any(String), "x", "raw");
	});
});
