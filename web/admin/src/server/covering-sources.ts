/**
 * One canonical scripture coordinate an article verifiably covers:
 * `{perek_id, pasuk}` — one row in tanah_article_covering_source (#2189 /
 * epic #2175 §3). An article has many rows; each is a single pasuk.
 *
 * This module is client-safe by contract: only pure types/predicates live
 * here. Transactional db helpers live in covering-sources-store.server.ts —
 * a plain exported function that touches ./db would ship mysql2 into the
 * browser bundle and crash at module init.
 */
export interface CoveringSource {
	perek_id: number;
	pasuk: number;
}

/**
 * Whether a query failure means the covering-source schema is not deployed
 * yet. MySQL reports ER_BAD_FIELD_ERROR (1054) for the missing
 * coverage_verified / pasuk_count columns and ER_NO_SUCH_TABLE (1146) for
 * the missing covering-source table — the only errors the reader may
 * degrade on; anything else is a real failure.
 */
export function isCoveringSourceSchemaMissing(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const { code, errno } = error as { code?: unknown; errno?: unknown };
	return (
		code === "ER_BAD_FIELD_ERROR" ||
		code === "ER_NO_SUCH_TABLE" ||
		errno === 1054 ||
		errno === 1146
	);
}

/**
 * Validates the client-supplied covering-source shape BEFORE touching the
 * database: integer coordinates, pasuk >= 1, and no duplicate mappings —
 * the composite primary key is the backstop, not the contract.
 */
export function normalizeCoveringSources(
	rows: CoveringSource[],
): CoveringSource[] {
	const seen = new Set<string>();
	const normalized: CoveringSource[] = [];
	for (const row of rows) {
		if (!Number.isInteger(row.perek_id) || !Number.isInteger(row.pasuk)) {
			throw new Error(
				"Covering sources must use integer perek and pasuk coordinates",
			);
		}
		if (row.pasuk < 1) {
			throw new Error(
				`Covering source pasuk must be at least 1 (got ${row.pasuk} for perek ${row.perek_id})`,
			);
		}
		const key = `${row.perek_id}:${row.pasuk}`;
		if (seen.has(key)) {
			throw new Error(
				`Duplicate covering source for perek ${row.perek_id} pasuk ${row.pasuk}`,
			);
		}
		seen.add(key);
		normalized.push({ perek_id: row.perek_id, pasuk: row.pasuk });
	}
	return normalized;
}
