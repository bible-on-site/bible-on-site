import type mysql from "mysql2/promise";
import { txExecute, txQuery } from "./db";

/**
 * One canonical scripture coordinate an article verifiably covers:
 * `{perek_id, pasuk}` — one row in tanah_article_covering_source (#2189 /
 * epic #2175 §3). An article has many rows; each is a single pasuk.
 */
export interface CoveringSource {
	perek_id: number;
	pasuk: number;
}

interface PerekPasukBoundRow {
	id: number;
	pasuk_count: number | null;
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

/**
 * Validates every covering coordinate exists in canonical scripture inside
 * the save transaction: each perek must be a real tanah_perek row and each
 * pasuk must be within its canonical pasuk_count. A NULL count means the
 * corpus counts were never loaded — the bound is unknown, so the write is
 * rejected rather than guessed.
 */
export async function assertCoveringSourcesExist(
	conn: mysql.PoolConnection,
	rows: CoveringSource[],
): Promise<void> {
	const perekIds = [...new Set(rows.map((row) => row.perek_id))];
	if (perekIds.length === 0) return;
	const placeholders = perekIds.map(() => "?").join(", ");
	const bounds = await txQuery<PerekPasukBoundRow>(
		conn,
		`SELECT id, pasuk_count FROM tanah_perek WHERE id IN (${placeholders})`,
		perekIds,
	);
	const boundById = new Map(bounds.map((row) => [row.id, row.pasuk_count]));
	for (const perekId of perekIds) {
		if (!boundById.has(perekId)) {
			throw new Error(`Covering source perek ${perekId} does not exist`);
		}
		if (boundById.get(perekId) === null) {
			throw new Error(
				`Canonical pasuk count is missing for perek ${perekId}; apply tanah_perek_pasuk_count_data.sql`,
			);
		}
	}
	for (const row of rows) {
		const pasukCount = boundById.get(row.perek_id);
		if (
			pasukCount !== undefined &&
			pasukCount !== null &&
			row.pasuk > pasukCount
		) {
			throw new Error(
				`Covering source pasuk ${row.pasuk} is out of range for perek ${row.perek_id} (1-${pasukCount})`,
			);
		}
	}
}

/**
 * Replaces the article's covering-source set inside the save transaction:
 * clears existing rows, inserts the validated set, and stores the explicit
 * verified state. Verified coverage requires at least one row — an empty
 * set is saved as coverage unknown, never as verified-to-cover-nothing.
 *
 * A pre-upgrade database (no covering table, no flag column) already holds
 * exactly the state an unverified empty submission asks for, so that case
 * degrades to a no-op — the new-article form always submits an empty set.
 * Authored rows or a verified request can never be honored without the
 * schema, so their failures always surface.
 */
export async function replaceCoveringSources(
	conn: mysql.PoolConnection,
	articleId: number,
	rows: CoveringSource[],
	verified: boolean,
): Promise<void> {
	if (verified && rows.length === 0) {
		throw new Error(
			"Verified coverage requires at least one covering source; submit coverageVerified: false to keep coverage unknown",
		);
	}
	try {
		await txExecute(
			conn,
			"DELETE FROM tanah_article_covering_source WHERE article_id = ?",
			[articleId],
		);
		if (rows.length > 0) {
			const placeholders = rows.map(() => "(?, ?, ?)").join(", ");
			const params = rows.flatMap((row) => [
				articleId,
				row.perek_id,
				row.pasuk,
			]);
			await txExecute(
				conn,
				`INSERT INTO tanah_article_covering_source (article_id, perek_id, pasuk) VALUES ${placeholders}`,
				params,
			);
		}
		await txExecute(
			conn,
			"UPDATE tanah_article SET coverage_verified = ? WHERE id = ?",
			[verified, articleId],
		);
	} catch (error) {
		if (!isCoveringSourceSchemaMissing(error) || verified || rows.length > 0) {
			throw error;
		}
	}
}

/**
 * Applies a standalone verified-state change (coveringSources omitted):
 * verification demands at least one already-persisted covering row, so
 * "mark verified" on an unmapped article is rejected rather than hiding it
 * from every range lookup.
 */
export async function updateCoverageVerified(
	conn: mysql.PoolConnection,
	articleId: number,
	verified: boolean,
): Promise<void> {
	try {
		if (verified) {
			const rows = await txQuery<{ covering_count: number }>(
				conn,
				"SELECT COUNT(*) AS covering_count FROM tanah_article_covering_source WHERE article_id = ?",
				[articleId],
			);
			if ((rows[0]?.covering_count ?? 0) === 0) {
				throw new Error(
					"Cannot verify coverage for an article with no covering sources; add covering sources or submit coverageVerified: false",
				);
			}
		}
		await txExecute(
			conn,
			"UPDATE tanah_article SET coverage_verified = ? WHERE id = ?",
			[verified, articleId],
		);
	} catch (error) {
		// On a pre-upgrade database an unverified flag write asks to store
		// the state that already holds there, so it degrades; a verified
		// request can never be honored without the schema and must surface.
		if (!isCoveringSourceSchemaMissing(error) || verified) {
			throw error;
		}
	}
}
