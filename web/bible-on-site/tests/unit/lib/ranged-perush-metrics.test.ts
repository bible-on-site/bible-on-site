/**
 * Ranged perush reading-metrics aggregation (#3108): the per-note word
 * counts `getPerushNotesForRanges` joins from `tanah_note_metric`
 * become the badge metric plus ordered progress units — or nothing at
 * all when any count is unknown.
 */
import {
	rangedNotesReadingMetrics,
	selectionScopedNoteMetric,
} from "../../../src/lib/perushim/ranged-metrics";
import type { RangedPerushNote } from "../../../src/lib/perushim";
import type { ReadingProgressUnit } from "../../../src/lib/reading-metrics/types";

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
		noteContent: `note ${perekId}:${pasuk}:${noteIdx}`,
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

describe("selectionScopedNoteMetric", () => {
	const units: ReadingProgressUnit[] = [
		{ key: "1:0", wordCount: 40, cumulativeWords: 40 },
		{ key: "2:0", wordCount: 100, cumulativeWords: 140 },
		{ key: "2:1", wordCount: 80, cumulativeWords: 220 },
	];
	const notes = [
		{ pasuk: 1, noteIdx: 0 },
		{ pasuk: 2, noteIdx: 0 },
		{ pasuk: 2, noteIdx: 1 },
	];

	it("aggregates the stored counts of exactly the rendered notes", () => {
		// A selection leaving only pasuk 2's two notes: 100 + 80 = 180
		// words → ceil(180 * 60 / 220) = 50 seconds.
		expect(
			selectionScopedNoteMetric(units, [notes[1], notes[2]]),
		).toEqual({ wordCount: 180, estimatedSeconds: 50 });
	});

	it("covers every rendered note even when several share a pasuk", () => {
		expect(selectionScopedNoteMetric(units, notes)).toEqual({
			wordCount: 220,
			estimatedSeconds: 60,
		});
	});

	it("reports a verified-empty metric for an empty selection", () => {
		expect(selectionScopedNoteMetric(units, [])).toEqual({
			wordCount: 0,
			estimatedSeconds: 0,
		});
	});

	it("is unknown while the note units are still loading", () => {
		expect(selectionScopedNoteMetric(undefined, notes)).toBeUndefined();
		expect(selectionScopedNoteMetric(units, undefined)).toBeUndefined();
	});

	it("is unknown when any rendered note has no stored count", () => {
		// Pasuk 3 renders without a metric row — a partial estimate must
		// never present as the selection's count.
		expect(
			selectionScopedNoteMetric(units, [
				notes[0],
				{ pasuk: 3, noteIdx: 0 },
			]),
		).toBeUndefined();
	});
});
