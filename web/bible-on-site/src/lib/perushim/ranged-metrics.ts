/**
 * Reading metrics for range-clipped commentary (#3108).
 *
 * A perush bounded to a reading unit's canonical ranges spans slices of
 * several perakim, so no single stored `tanah_perush_metric` row describes
 * it. The persisted `tanah_note_metric` word counts — fetched with the notes
 * themselves — aggregate into the range's own metric: the estimate sums the
 * counted notes at the shared baseline, and the progress units chain their
 * cumulative counts in *range order* (the stored `cumulative_words` sequence
 * is per-perek only and cannot serve a cross-perek view).
 *
 * The contract stays honest about unknowns: one note without a stored count
 * makes the whole-range metric unknown — the view omits the badge and the
 * progress bar rather than estimating a partial total.
 */
import { estimateReadingSeconds } from "../reading-metrics/policy";
import type {
	ReadingMetric,
	ReadingProgressUnit,
} from "../reading-metrics/types";
import type { RangedPerushNote } from "./service";

export interface RangedPerushMetrics {
	/**
	 * Aggregate metric over the rendered notes — present only when every
	 * rendered note carried a stored `wordCount`.
	 */
	metric?: ReadingMetric;
	/**
	 * Ordered units for `ReadingProgress`, keyed
	 * `{perekId}:{pasuk}:{noteIdx}` to match the rendered
	 * `data-reading-unit` elements. Empty when the metric is unknown or
	 * there is no counted text to progress through.
	 */
	units: ReadingProgressUnit[];
}

/**
 * Fold a ranged note list into its shared-metric decoration. `notes` must
 * already be in the view's render order (the service returns range order).
 */
export function rangedPerushMetrics(
	notes: readonly RangedPerushNote[],
): RangedPerushMetrics {
	const units: ReadingProgressUnit[] = [];
	let wordCount = 0;
	for (const note of notes) {
		if (typeof note.wordCount !== "number") return { units: [] };
		wordCount += note.wordCount;
		units.push({
			key: `${note.perekId}:${note.pasuk}:${note.noteIdx}`,
			wordCount: note.wordCount,
			cumulativeWords: wordCount,
		});
	}
	if (units.length === 0) return { units };
	return {
		metric: {
			wordCount,
			estimatedSeconds: estimateReadingSeconds(wordCount),
		},
		// A zero-word axis cannot carry progress — the bar would sit at 0%
		// forever, reading as a defect rather than an honest empty state.
		units: wordCount > 0 ? units : [],
	};
}
