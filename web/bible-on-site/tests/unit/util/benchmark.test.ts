/** @jest-environment node */
import { writeBenchmark } from "../../../scripts/benchmark-store.cjs";
import {
	budgetedTimingBenchmarkEntry,
	getLighthouseMeasure,
	reportFrameBlockingBenchmark,
	webVitalsMeasure,
} from "../../util/benchmark";

jest.mock("../../../scripts/benchmark-store.cjs", () => ({
	writeBenchmark: jest.fn(),
}));

describe("reportFrameBlockingBenchmark", () => {
	it.each([
		[0, 0],
		[16.6, 0.00415],
	])(
		"keeps %sms of blocking within the unchanged 4000ms budget",
		(blockedMs, expectedRatio) => {
			reportFrameBlockingBenchmark(
				"sefer-flip/929-drag-blocked",
				blockedMs,
				4000,
			);
			const [, metric] = jest.mocked(writeBenchmark).mock.calls[0];
			expect(metric.name).toBe("sefer-flip/929-drag-blocked");
			expect(metric.measure).toBe("frame_budget_ratio");
			expect(metric.value).toBeCloseTo(expectedRatio, 12);
			expect(metric.value).toBeLessThanOrEqual(metric.upperValue);
			expect(metric.upperValue).toBe(1);
		},
	);

	it.each([4000, 8000, 16000])(
		"preserves the exact %sms CPU-calibrated boundary without clipping",
		(budgetMs) => {
			reportFrameBlockingBenchmark("at-limit", budgetMs, budgetMs);
			reportFrameBlockingBenchmark("over-limit", budgetMs + 16.6, budgetMs);
			const calls = jest.mocked(writeBenchmark).mock.calls;
			const atLimit = calls[0][1];
			const overLimit = calls[1][1];
			expect(atLimit.value).toBe(atLimit.upperValue);
			expect(overLimit.value).toBeGreaterThan(overLimit.upperValue);
		},
	);
});

describe("webVitalsMeasure", () => {
	it("maps CLS to its dedicated statically-gated measure", () => {
		// #2718: CLS must not share `ratio`, whose percentage threshold
		// collapses to a zero upper limit on a zero baseline.
		expect(webVitalsMeasure("CLS")).toBe("cls_ratio");
	});

	it.each(["FCP", "INP", "LCP", "TTFB"])(
		"maps the %s timing metric to time_ms",
		(name) => {
			expect(webVitalsMeasure(name)).toBe("time_ms");
		},
	);
});

describe("budgetedTimingBenchmarkEntry", () => {
	it.each([
		["INP", 16, 200, 0.08],
		["TTFB", 5.7, 800, 0.007125],
		["FCP", 96, 1800, 96 / 1800],
		["LCP", 104, 2500, 104 / 2500],
	] as const)(
		"normalizes %s of %sms onto the static bound of its %sms web budget",
		(name, value, budget, expectedRatio) => {
			// #2971: an 8ms-quantized single-digit-ms timing makes any
			// percentage-of-history boundary fire on runner noise; the static
			// bound keeps the test's own "good" budget as the alert limit.
			const entry = budgetedTimingBenchmarkEntry({
				name: `webvitals: ${name}`,
				measure: "time_ms",
				value,
				upperValue: budget,
			});
			expect(entry.measure).toBe("frame_budget_ratio");
			expect(entry.value).toBeCloseTo(expectedRatio, 12);
			expect(entry.upperValue).toBe(1);
		},
	);

	it("keeps non-timing measures on their dedicated measures", () => {
		const cls = budgetedTimingBenchmarkEntry({
			name: "webvitals: CLS",
			measure: "cls_ratio",
			value: 0.02,
			upperValue: 0.1,
		});
		expect(cls).toEqual({
			name: "webvitals: CLS",
			measure: "cls_ratio",
			value: 0.02,
			upperValue: 0.1,
		});
	});

	it.each([
		["missing", undefined],
		["zero", 0],
		["negative", -1],
		["non-finite", Number.NaN],
	])(
		"leaves a timing entry untouched when the budget is %s",
		(_label, upperValue) => {
			const entry = budgetedTimingBenchmarkEntry({
				name: "t",
				measure: "time_ms",
				value: 12,
				upperValue,
			});
			expect(entry.measure).toBe("time_ms");
			expect(entry.value).toBe(12);
			expect(entry.upperValue).toBe(upperValue);
		},
	);
});

describe("getLighthouseMeasure", () => {
	it.each([
		["millisecond", "time_ms"],
		["byte", "bytes"],
		["element", "count"],
		["unitless", "score"],
		[undefined, "score"],
	] as const)("maps numericUnit %s to %s", (unit, measure) => {
		expect(getLighthouseMeasure(unit)).toBe(measure);
	});
});
