/**
 * Normalize the `[uniqueName]` route segment for DB lookup.
 *
 * Next.js supplies URL-decoded dynamic segments; users may still open percent-encoded
 * URLs. Invalid `%` sequences fall back to the raw segment.
 */
export function normalizedUniqueNameFromParam(segment: string): string {
	const trimmed = segment.trim();
	let decoded = trimmed;
	try {
		decoded = decodeURIComponent(trimmed);
	} catch {
		// Malformed escapes — use trimmed segment as-is
	}
	return decoded.normalize("NFC");
}
