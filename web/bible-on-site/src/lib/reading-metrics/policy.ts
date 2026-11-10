/**
 * Estimate policy mirror for the shared reading metrics (#2607).
 *
 * Mirrors `web/shared/reading-metrics/policy.ts` — the website package does
 * not cross its bundler root, so the small numeric contract is restated here
 * (the same reason `format.ts` restates the display contract). Keep both in
 * sync: stored `estimated_seconds` values are computed at this rate, so a
 * consumer-side aggregation must estimate identically.
 *
 * Baseline: 220 words/minute for Hebrew silent reading — a rounded product
 * choice informed by Brysbaert's 2019 meta-analysis (224 wpm for Hebrew).
 * It is an *estimate*, not required learning time, recitation length or
 * measured reader performance.
 */
export const READING_WORDS_PER_MINUTE = 220;

/**
 * estimatedReadingSeconds = ceil(wordCount * 60 / wordsPerMinute).
 * A verified-empty body (wordCount 0) honestly estimates 0 seconds — callers
 * distinguish it from a missing metric and must not fabricate a one-minute
 * floor onto empty content.
 */
export function estimateReadingSeconds(
	wordCount: number,
	wordsPerMinute: number = READING_WORDS_PER_MINUTE,
): number {
	if (wordCount <= 0) return 0;
	return Math.ceil((wordCount * 60) / wordsPerMinute);
}
