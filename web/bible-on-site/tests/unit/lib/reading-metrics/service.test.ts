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
	getArticleProgressUnits,
	getEntryMetric,
	getEntryProgressUnits,
	getPerekMetric,
	getPerekMetrics,
	getPerekProgressUnits,
	getPerekProgressUnitsBatch,
	getPerushMetric,
	getPerushMetricsByPerekId,
	getPerushProgressUnits,
	getPerushProgressUnitsBatch,
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

describe("getPerekMetrics", () => {
	beforeEach(() => jest.clearAllMocks());

	it("keys stored rows by perek id", async () => {
		mockQuery.mockResolvedValueOnce([
			{ perek_id: 5, word_count: 100, estimated_seconds: 28 },
		] as never);
		const map = await getPerekMetrics([5, 6]);
		expect(map.get(5)).toEqual({ wordCount: 100, estimatedSeconds: 28 });
		expect(map.has(6)).toBe(false);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("tanah_perek_metric"),
			[5, 6],
		);
	});

	it("returns an empty map for no ids or missing schema", async () => {
		expect((await getPerekMetrics([])).size).toBe(0);
		expect(mockQuery).not.toHaveBeenCalled();
		mockQuery.mockRejectedValueOnce({ errno: 1146 } as never);
		expect((await getPerekMetrics([1])).size).toBe(0);
	});
});

describe("getPerekProgressUnits", () => {
	beforeEach(() => jest.clearAllMocks());

	it("maps pasuk rows to keyed units in order", async () => {
		mockQuery.mockResolvedValueOnce([
			{ pasuk: 1, word_count: 10, cumulative_words: 10 },
			{ pasuk: 2, word_count: 20, cumulative_words: 30 },
		] as never);
		expect(await getPerekProgressUnits(1)).toEqual([
			{ key: "1", wordCount: 10, cumulativeWords: 10 },
			{ key: "2", wordCount: 20, cumulativeWords: 30 },
		]);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("tanah_perek_pasuk_metric"),
			[1],
		);
	});

	it("degrades to an empty list on missing schema", async () => {
		mockQuery.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" } as never);
		expect(await getPerekProgressUnits(1)).toEqual([]);
	});
});

describe("getPerekProgressUnitsBatch", () => {
	beforeEach(() => jest.clearAllMocks());

	it("groups stored rows by perek id", async () => {
		mockQuery.mockResolvedValueOnce([
			{ perek_id: 5, pasuk: 1, word_count: 10, cumulative_words: 10 },
			{ perek_id: 5, pasuk: 2, word_count: 20, cumulative_words: 30 },
			{ perek_id: 6, pasuk: 1, word_count: 5, cumulative_words: 5 },
		] as never);
		const map = await getPerekProgressUnitsBatch([5, 6]);
		expect(map.get(5)).toEqual([
			{ key: "1", wordCount: 10, cumulativeWords: 10 },
			{ key: "2", wordCount: 20, cumulativeWords: 30 },
		]);
		expect(map.get(6)).toEqual([
			{ key: "1", wordCount: 5, cumulativeWords: 5 },
		]);
		expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [5, 6]);
	});

	it("returns an empty map for no ids or missing schema", async () => {
		expect((await getPerekProgressUnitsBatch([])).size).toBe(0);
		expect(mockQuery).not.toHaveBeenCalled();
		mockQuery.mockRejectedValueOnce({ errno: 1146 } as never);
		expect((await getPerekProgressUnitsBatch([1])).size).toBe(0);
	});
});

describe("getArticleProgressUnits", () => {
	beforeEach(() => jest.clearAllMocks());

	it("maps block rows to positionally-keyed units", async () => {
		mockQuery.mockResolvedValueOnce([
			{ block_idx: 0, word_count: 12, cumulative_words: 12 },
			{ block_idx: 1, word_count: 8, cumulative_words: 20 },
		] as never);
		expect(await getArticleProgressUnits(7)).toEqual([
			{ key: null, wordCount: 12, cumulativeWords: 12 },
			{ key: null, wordCount: 8, cumulativeWords: 20 },
		]);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("tanah_article_metric_block"),
			[7],
		);
	});

	it("degrades to an empty list on missing schema", async () => {
		mockQuery.mockRejectedValueOnce({ errno: 1146 } as never);
		expect(await getArticleProgressUnits(7)).toEqual([]);
	});
});

describe("getEntryProgressUnits", () => {
	beforeEach(() => jest.clearAllMocks());

	it("binds the entry id and maps block rows", async () => {
		mockQuery.mockResolvedValueOnce([
			{ block_idx: 0, word_count: 6, cumulative_words: 6 },
		] as never);
		expect(await getEntryProgressUnits("uuid-1")).toEqual([
			{ key: null, wordCount: 6, cumulativeWords: 6 },
		]);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("tanahpedia_entry_metric_block"),
			["uuid-1"],
		);
	});

	it("degrades to an empty list on missing schema", async () => {
		mockQuery.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" } as never);
		expect(await getEntryProgressUnits("uuid-1")).toEqual([]);
	});
});

describe("getPerushProgressUnits", () => {
	beforeEach(() => jest.clearAllMocks());

	it("maps note rows to pasuk:noteIdx keys", async () => {
		mockQuery.mockResolvedValueOnce([
			{ pasuk: 3, note_idx: 1, word_count: 7, cumulative_words: 7 },
			{ pasuk: 3, note_idx: 2, word_count: 9, cumulative_words: 16 },
		] as never);
		expect(await getPerushProgressUnits(10, 5)).toEqual([
			{ key: "3:1", wordCount: 7, cumulativeWords: 7 },
			{ key: "3:2", wordCount: 9, cumulativeWords: 16 },
		]);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("tanah_note_metric"),
			[10, 5],
		);
	});

	it("degrades to an empty list on missing schema", async () => {
		mockQuery.mockRejectedValueOnce({ errno: 1146 } as never);
		expect(await getPerushProgressUnits(10, 5)).toEqual([]);
	});
});

describe("getPerushProgressUnitsBatch", () => {
	beforeEach(() => jest.clearAllMocks());

	it("groups note rows by perush id", async () => {
		mockQuery.mockResolvedValueOnce([
			{
				perush_id: 10,
				pasuk: 1,
				note_idx: 1,
				word_count: 7,
				cumulative_words: 7,
			},
			{
				perush_id: 11,
				pasuk: 1,
				note_idx: 1,
				word_count: 4,
				cumulative_words: 4,
			},
		] as never);
		const map = await getPerushProgressUnitsBatch(5, [10, 11]);
		expect(map.get(10)).toEqual([
			{ key: "1:1", wordCount: 7, cumulativeWords: 7 },
		]);
		expect(map.get(11)).toEqual([
			{ key: "1:1", wordCount: 4, cumulativeWords: 4 },
		]);
		expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [5, 10, 11]);
	});

	it("returns an empty map for no ids or missing schema", async () => {
		expect((await getPerushProgressUnitsBatch(5, [])).size).toBe(0);
		expect(mockQuery).not.toHaveBeenCalled();
		mockQuery.mockRejectedValueOnce({ errno: 1146 } as never);
		expect((await getPerushProgressUnitsBatch(5, [10])).size).toBe(0);
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
