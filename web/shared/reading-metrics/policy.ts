/**
 * Shared reading-metrics policy (#2607) — the single source of truth for the
 * estimate baseline. Keep this in sync with the persisted rows:
 * `calc_version` identifies the counting policy that produced a stored metric
 * and `words_per_minute` records the rate the estimate used, so a policy or
 * rate change is a cheap deterministic recomputation from stored counts,
 * never an ambiguous retro-interpretation.
 *
 * Baseline: 220 words/minute for Hebrew silent reading — a rounded product
 * choice informed by Brysbaert's 2019 meta-analysis (224 wpm for Hebrew across
 * five studies/168 participants). It is an *estimate*, not required learning
 * time, recitation length or measured reader performance.
 */
export const READING_WORDS_PER_MINUTE = 220;

/**
 * Counting-policy version persisted on every metric row. Bump when the
 * normalization/tokenization semantics change so older rows are detectably
 * stale and recompute cleanly on the next maintenance pass.
 *
 * v1: script/style removal, entity decode, NFD mark strip (niqqud/taamim
 * never become words), quote/geresh/gershayim strip, maqaf and intra-word
 * hyphen join words, everything else separates.
 */
export const READING_METRICS_CALC_VERSION = 1;

/**
 * estimatedReadingSeconds = ceil(wordCount * 60 / wordsPerMinute).
 * A verified-empty body (wordCount 0) honestly estimates 0 seconds — callers
 * distinguish it from a missing metric (null) and must not fabricate a
 * one-minute floor onto empty content.
 */
export function estimateReadingSeconds(
	wordCount: number,
	wordsPerMinute: number = READING_WORDS_PER_MINUTE,
): number {
	if (wordCount <= 0) return 0;
	return Math.ceil((wordCount * 60) / wordsPerMinute);
}
