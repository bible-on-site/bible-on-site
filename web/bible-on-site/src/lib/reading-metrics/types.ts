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
