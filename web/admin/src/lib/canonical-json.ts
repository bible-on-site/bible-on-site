/**
 * Deterministic canonical JSON — object keys sorted, `undefined` values
 * dropped, so semantically equal payloads serialize byte-identically.
 * `JSON.stringify` alone does not guarantee a stable key ordering across
 * inputs, so dedupe/decision keys (#3103) and request bodies that must be
 * byte-stable go through this instead. Pure and client-safe.
 */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : 1));
		return `{${entries
			.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}
