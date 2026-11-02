/** @jest-environment node */
import { writeBenchmark } from "../../../scripts/benchmark-store.cjs";
import {
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
