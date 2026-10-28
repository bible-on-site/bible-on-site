/** @jest-environment node */
import {
	getLighthouseMeasure,
	webVitalsMeasure,
} from "../../util/benchmark";

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
