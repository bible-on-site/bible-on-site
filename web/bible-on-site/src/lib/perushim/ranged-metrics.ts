// Import the pure contract directly — never the barrel: `service.ts`
// pulls `api-client`/mysql2 and `server-only`, while this module ships
// inside client bundles via the ranged perush views (#2607).
import type { ReadingMetric, ReadingProgressUnit } from "../reading-metrics/types";
import type { RangedPerushNote } from "./service";
import type { PerushNote } from "./types";

/**
 * Reading-metrics view model for a range-bounded perush (#3108) — the
 * badge metric plus the ordered progress units `ReadingProgress`
 * consumes, aggregated from the per-note `wordCount` values
 * `getPerushNotesForRanges` joined in from `tanah_note_metric`.
 */
export interface RangedPerushMetrics {
	/**
	 * Whole-range metric; absent when any note's count is unknown — the
	 * stored-metrics contract never fabricates a partial estimate.
	 */
	metric?: ReadingMetric;
	/**
	 * Per-note units keyed `{perekId}:{pasuk}:{noteIdx}` — the full
	 * position key, because a ranged view repeats pasuk numbers across
	 * perakim — with `cumulativeWords` in *range* order (the stored
	 * `cumulative_words` restarts per perek and cannot serve a
	 * cross-perek view).
	 */
	units: ReadingProgressUnit[];
}

/**
 * `estimatedSeconds` baseline — restates `estimateReadingSeconds` from
 * `web/shared/reading-metrics/policy.ts` (the website package does not
 * cross its bundler root, so the small policy is mirrored here like
 * `lib/reading-metrics/format.ts` does for the display side).
 */
const READING_WORDS_PER_MINUTE = 220;

function estimateReadingSeconds(wordCount: number): number {
	if (wordCount <= 0) return 0;
	return Math.ceil((wordCount * 60) / READING_WORDS_PER_MINUTE);
}

/**
 * Aggregate a range-bounded note list into its reading-metrics view
 * model. `notes` must already be in the view's range order — the order
 * `getPerushNotesForRanges` returns — since `cumulativeWords` follows
 * it. Any note with an unknown `wordCount` makes the whole result
 * unknown: an empty `units` list and no `metric`, so views omit both
 * the badge and the progress bar instead of estimating a subset.
 */
export function rangedNotesReadingMetrics(
	notes: readonly RangedPerushNote[],
): RangedPerushMetrics {
	const units: ReadingProgressUnit[] = [];
	let total = 0;
	for (const note of notes) {
		if (note.wordCount == null) return { units: [] };
		total += note.wordCount;
		units.push({
			key: `${note.perekId}:${note.pasuk}:${note.noteIdx}`,
			wordCount: note.wordCount,
			cumulativeWords: total,
		});
	}
	return {
		metric: {
			wordCount: total,
			estimatedSeconds: estimateReadingSeconds(total),
		},
		units,
	};
}

/**
 * Selection-scoped estimate (#2607): aggregate the stored `tanah_note_metric`
 * counts of a perush's *rendered* notes — e.g. the subset a pasuk selection
 * leaves on the perek — into the same `{wordCount, estimatedSeconds}`
 * contract the whole-perek `tanah_perush_metric` row carries. `units` are
 * the perush's `pasuk:noteIdx`-keyed note rows for the perek; `notes` the
 * notes actually shown (already filtered to the selection).
 *
 * Returns `undefined` — metric unknown — when either input is still loading
 * or when any rendered note has no stored unit row: a partial estimate must
 * never present as the selection's count. `ReadingTime` treats the returned
 * `0`s of an empty selection as verified-empty and renders nothing.
 */
export function selectionScopedNoteMetric(
	units: readonly ReadingProgressUnit[] | undefined,
	notes: readonly Pick<PerushNote, "pasuk" | "noteIdx">[] | undefined,
): ReadingMetric | undefined {
	if (!units || !notes) return undefined;
	const counts = new Map(units.map((unit) => [unit.key, unit.wordCount]));
	let wordCount = 0;
	for (const note of notes) {
		const count = counts.get(`${note.pasuk}:${note.noteIdx}`);
		if (count == null) return undefined;
		wordCount += count;
	}
	return {
		wordCount,
		estimatedSeconds: estimateReadingSeconds(wordCount),
	};
}
