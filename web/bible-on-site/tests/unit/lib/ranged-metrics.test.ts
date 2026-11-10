/**
 * Ranged commentary metrics (#3108): stored per-note `tanah_note_metric`
 * counts fold into the range's own ReadingMetric plus keyed progress
 * units — cumulative in range order, and honest about unknown counts:
 * one uncounted note marks the whole range unknown.
 */
import type { RangedPerushNote } from "../../../src/lib/perushim";
import { rangedPerushMetrics } from "../../../src/lib/perushim/ranged-metrics";

function note(
	perekId: number,
	pasuk: number,
	noteIdx: number,
	wordCount?: number | null,
): RangedPerushNote {
	return {
		perekId,
		pasuk,
		noteIdx,
		noteContent: "<p>x</p>",
		wordCount,
	};
}

describe("rangedPerushMetrics", () => {
	it("returns no metric or units for an empty note list", () => {
		expect(rangedPerushMetrics([])).toEqual({ units: [] });
	});

	it("sums stored counts into the range metric and chains cumulative units", () => {
		const result = rangedPerushMetrics([
			note(3, 7, 0, 40),
			note(3, 7, 1, 30),
			note(4, 1, 0, 50),
		]);

		expect(result.metric).toEqual({
			wordCount: 120,
			// The shared 220 wpm baseline: ceil(120 * 60 / 220) = 33.
			estimatedSeconds: 33,
		});
		expect(result.units).toEqual([
			{ key: "3:7:0", wordCount: 40, cumulativeWords: 40 },
			{ key: "3:7:1", wordCount: 30, cumulativeWords: 70 },
			{ key: "4:1:0", wordCount: 50, cumulativeWords: 120 },
		]);
	});

	it("accumulates in the given range order across perakim", () => {
		// A cross-perek parasha returns perek 100 before perek 1; the
		// cumulative axis follows the render order, not perek_id order.
		const result = rangedPerushMetrics([
			note(100, 7, 0, 10),
			note(1, 1, 0, 20),
		]);
		expect(result.units.map((unit) => unit.cumulativeWords)).toEqual([10, 30]);
		expect(result.units.map((unit) => unit.key)).toEqual(["100:7:0", "1:1:0"]);
	});

	it("marks the whole range unknown when any note lacks a stored count", () => {
		expect(rangedPerushMetrics([note(1, 1, 0, 40), note(1, 2, 0)])).toEqual({
			units: [],
		});
	});

	it("treats an explicit null count as unknown too", () => {
		expect(rangedPerushMetrics([note(1, 1, 0, null)])).toEqual({
			units: [],
		});
	});

	it("omits progress units when the counted total is zero words", () => {
		const result = rangedPerushMetrics([note(1, 1, 0, 0), note(1, 2, 0, 0)]);
		expect(result.metric).toEqual({ wordCount: 0, estimatedSeconds: 0 });
		expect(result.units).toEqual([]);
	});
});
