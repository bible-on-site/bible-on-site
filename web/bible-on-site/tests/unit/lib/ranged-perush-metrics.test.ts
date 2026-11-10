/**
 * Ranged perush reading-metrics aggregation (#3108): the per-note word
 * counts `getPerushNotesForRanges` joins from `tanah_note_metric`
 * become the badge metric plus ordered progress units — or nothing at
 * all when any count is unknown.
 */
import { rangedNotesReadingMetrics } from "../../../src/lib/perushim/ranged-metrics";
import type { RangedPerushNote } from "../../../src/lib/perushim";

function note(
	perekId: number,
	pasuk: number,
	noteIdx = 0,
	wordCount?: number,
): RangedPerushNote {
	return {
		perekId,
		pasuk,
		noteIdx,
		noteContent: `<p>${perekId}-${pasuk}-${noteIdx}</p>`,
		...(wordCount != null && { wordCount }),
	};
}

describe("rangedNotesReadingMetrics", () => {
	it("aggregates units keyed {perekId}:{pasuk}:{noteIdx} in range order", () => {
		// Cross-perek order: the stored per-perek cumulative could not
		// produce this sequence — the helper recomputes it.
		const notes = [note(2, 4, 0, 10), note(1, 5, 0, 20), note(1, 5, 1, 30)];

		const { units } = rangedNotesReadingMetrics(notes);

		expect(units).toEqual([
			{ key: "2:4:0", wordCount: 10, cumulativeWords: 10 },
			{ key: "1:5:0", wordCount: 20, cumulativeWords: 30 },
			{ key: "1:5:1", wordCount: 30, cumulativeWords: 60 },
		]);
	});

	it("computes the badge metric at the shared estimate baseline", () => {
		const notes = [note(1, 1, 0, 220), note(1, 2, 0, 221)];

		const { metric } = rangedNotesReadingMetrics(notes);

		// ceil(441 * 60 / 220) = ceil(120.27) = 121 seconds.
		expect(metric).toEqual({ wordCount: 441, estimatedSeconds: 121 });
	});

	it("treats zero-count notes as counted, never as missing", () => {
		const { metric, units } = rangedNotesReadingMetrics([
			note(1, 1, 0, 0),
			note(1, 2, 0, 10),
		]);

		expect(metric).toEqual({ wordCount: 10, estimatedSeconds: 3 });
		expect(units[0]).toEqual({
			key: "1:1:0",
			wordCount: 0,
			cumulativeWords: 0,
		});
	});

	it("reports a verified-empty metric for an empty note list", () => {
		expect(rangedNotesReadingMetrics([])).toEqual({
			metric: { wordCount: 0, estimatedSeconds: 0 },
			units: [],
		});
	});

	it("omits the whole metric and units when any note count is unknown", () => {
		const notes = [note(1, 1, 0, 12), note(1, 2, 0), note(1, 3, 0, 5)];

		const { metric, units } = rangedNotesReadingMetrics(notes);

		expect(metric).toBeUndefined();
		expect(units).toEqual([]);
	});
});
