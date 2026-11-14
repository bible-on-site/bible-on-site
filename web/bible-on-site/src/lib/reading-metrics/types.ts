/**
 * Shared reading-metrics contract (#2607) — the fields a consumer reads.
 *
 * A persisted metric row holds a complete-text `wordCount` and the baseline
 * `estimatedSeconds` derived from it at the shared 220-words-per-minute Hebrew
 * silent-reading rate (`ceil(wordCount * 60 / wordsPerMinute)`).
 *
 * `null` fields mean the metric is unknown/not yet computed — distinct from a
 * verified-empty body, which carries `wordCount: 0` / `estimatedSeconds: 0`.
 */
export interface ReadingMetric {
	/** Complete-text word count; `null` = unknown. `0` = verified empty. */
	wordCount: number | null;
	/** Baseline estimated reading seconds; `null` when `wordCount` is. */
	estimatedSeconds: number | null;
}

/**
 * One stored progress unit — an ordered readable block in the content's
 * own word axis (`*_metric_block` / `tanah_perek_pasuk_metric` /
 * `tanah_note_metric` rows). `key` identifies the rendered element the
 * unit maps to: the pasuk number for perakim, the `pasuk:noteIdx` pair
 * for perush notes, or the `block_idx` ordinal for HTML content whose
 * units are located by DOM segmentation instead of an explicit key.
 */
export interface ReadingProgressUnit {
	/** Unit key in the content's own coordinate space (`null` for
	 * positional HTML blocks, which align by document order). */
	key: string | null;
	/** Words this unit contributes. */
	wordCount: number;
	/** Words up to and including this unit, in canonical order. */
	cumulativeWords: number;
}
