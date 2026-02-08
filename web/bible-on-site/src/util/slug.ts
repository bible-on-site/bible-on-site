/**
 * General-purpose Hebrew-safe URL slug utilities.
 *
 * Hebrew text often contains "problematic" characters that break or clutter
 * URLs — geresh (׳), gershayim (״), ASCII quotes (" '), etc.
 * The helpers below strip those characters so that URLs work regardless of
 * whether the source text includes them, and produce clean percent-encoded slugs.
 *
 * Designed to be reused across entities (authors / parshanim / perushim / …).
 * This module has NO server-side dependencies (no DB, no mysql2) so it can
 * safely be imported from client components.
 */

/**
 * Characters stripped when sanitising Hebrew text for URL slugs.
 * Covers ASCII double/single quotes and their Hebrew equivalents.
 */
const PROBLEMATIC_CHARS = /["״׳']/g;

/**
 * Sanitise Hebrew text for URL matching.
 * Strips geresh / gershayim / quote characters and trims whitespace so that
 * e.g. `שליט"א` and `שליטא` are treated as identical.
 */
export function sanitizeForUrl(text: string): string {
	return text.replace(PROBLEMATIC_CHARS, "").trim();
}

/**
 * Build a URL-safe slug from Hebrew (or mixed) text.
 * The slug is the sanitised text, percent-encoded — Hebrew characters and
 * spaces are left to the browser's native encoding.
 */
export function toUrlSlug(text: string): string {
	return encodeURIComponent(sanitizeForUrl(text));
}
