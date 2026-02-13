import { query } from "../api-client";
import type { PerushDetail, PerushNote, PerushSummary } from "./types";

interface PerushSummaryRow {
	perush_id: number;
	perush_name: string;
	parshan_name: string;
	note_count: number;
	priority: number;
}

/**
 * Fetch available perushim for a given perek_id.
 * Ordered by priority (lower first), then by note count (most content first).
 *
 * Priority order (set at data generation time):
 * - Targum variants (תרגום): 0-99 (first, chronological among themselves)
 * - Rashi (רש"י): 100 (second)
 * - Other commentaries: 200+ (chronological by composition date)
 */
export async function getPerushimByPerekId(
	perekId: number,
): Promise<PerushSummary[]> {
	try {
		const rows = await query<PerushSummaryRow>(
			`SELECT
				p.id AS perush_id,
				p.name AS perush_name,
				pa.name AS parshan_name,
				COUNT(*) AS note_count,
				p.priority AS priority
			 FROM note n
			 JOIN perush p ON n.perush_id = p.id
			 JOIN parshan pa ON p.parshan_id = pa.id
			 WHERE n.perek_id = ?
			 GROUP BY p.id, p.name, pa.name, p.priority
			 ORDER BY p.priority ASC, note_count DESC`,
			[perekId],
		);

		return rows.map((row) => ({
			id: row.perush_id,
			name: row.perush_name,
			parshanName: row.parshan_name,
			noteCount: Number(row.note_count),
		}));
	} catch (error) {
		console.warn(
			"Failed to fetch perushim for perek %d:",
			perekId,
			error instanceof Error ? error.message : error,
		);
		return [];
	}
}

interface NoteRow {
	pasuk: number;
	note_idx: number;
	note_content: string;
}

/**
 * Fetch all notes for a specific perush on a specific perek.
 * Returns notes ordered by pasuk, then note_idx.
 */
export async function getPerushNotes(
	perushId: number,
	perekId: number,
): Promise<PerushNote[]> {
	try {
		const rows = await query<NoteRow>(
			`SELECT pasuk, note_idx, note_content
			 FROM note
			 WHERE perush_id = ? AND perek_id = ?
			 ORDER BY pasuk ASC, note_idx ASC`,
			[perushId, perekId],
		);

		return rows.map((row) => ({
			pasuk: row.pasuk,
			noteIdx: row.note_idx,
			noteContent: row.note_content,
		}));
	} catch (error) {
		console.warn(
			"Failed to fetch notes for perush %d perek %d:",
			perushId,
			perekId,
			error instanceof Error ? error.message : error,
		);
		return [];
	}
}

/**
 * Fetch full perush detail (metadata + notes) for display.
 */
export async function getPerushDetail(
	perushId: number,
	perekId: number,
): Promise<PerushDetail | null> {
	try {
		const metaRows = await query<{
			perush_name: string;
			parshan_name: string;
			parshan_birth_year: number | null;
		}>(
			`SELECT p.name AS perush_name, pa.name AS parshan_name, pa.birth_year AS parshan_birth_year
			 FROM perush p
			 JOIN parshan pa ON p.parshan_id = pa.id
			 WHERE p.id = ?`,
			[perushId],
		);

		if (metaRows.length === 0) return null;

		const notes = await getPerushNotes(perushId, perekId);
		const r = metaRows[0];

		return {
			id: perushId,
			name: r.perush_name,
			parshanName: r.parshan_name,
			...(r.parshan_birth_year != null && {
				parshanBirthYear: r.parshan_birth_year,
			}),
			notes,
		};
	} catch (error) {
		console.warn(
			"Failed to fetch perush detail %d:",
			perushId,
			error instanceof Error ? error.message : error,
		);
		return null;
	}
}
