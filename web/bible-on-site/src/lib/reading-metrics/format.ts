/**
 * Shared display policy for the persisted reading metrics (#2607).
 *
 * The estimate is a silent-reading baseline, not required learning time,
 * recitation length, or measured reader performance — hence the hedged label.
 * Mirrors the counting-side policy in `web/shared/reading-metrics/policy.ts`
 * (the website package does not cross its bundler root, so the small display
 * contract is restated here).
 */

/** Canonical UI label for the estimate. */
export const READING_TIME_LABEL = "זמן קריאה משוער";

const SECONDS_PER_MINUTE = 60;

/**
 * Format the stored `estimatedSeconds` for display.
 *
 * - `null`/`undefined` (metric unknown) → `null` — render nothing.
 * - `0` (verified-empty body) → `null` — never fabricate a minute.
 * - `< 60s` → `פחות מדקה`.
 * - `>= 60s` → whole minutes rounded up (`דקה`/`דקות`).
 */
export function formatEstimatedReadingTime(
	estimatedSeconds: number | null | undefined,
): string | null {
	if (estimatedSeconds == null || estimatedSeconds <= 0) {
		return null;
	}
	if (estimatedSeconds < SECONDS_PER_MINUTE) {
		return "פחות מדקה";
	}
	const minutes = Math.ceil(estimatedSeconds / SECONDS_PER_MINUTE);
	return minutes === 1 ? "דקה" : `${minutes} דקות`;
}

/** Full badge text (`זמן קריאה משוער: X`) or `null` when nothing to show. */
export function formatReadingTimeLabel(
	estimatedSeconds: number | null | undefined,
): string | null {
	const formatted = formatEstimatedReadingTime(estimatedSeconds);
	return formatted ? `${READING_TIME_LABEL}: ${formatted}` : null;
}

/** ISO-8601 duration (`PT240S`) for JSON-LD `timeRequired`. */
export function isoDurationSeconds(seconds: number): string {
	return `PT${Math.max(0, Math.round(seconds))}S`;
}
