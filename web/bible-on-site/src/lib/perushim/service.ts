import type { ScriptureRange } from "../reading/contract";
import {
	noteSliceCondition,
	slicePerekOrder,
	slicesForRanges,
} from "../reading/queries";
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

interface PerushPerekNamePair {
	perekId: number;
	perushName: string;
}

export async function getAllPerushPerekNamePairs(): Promise<PerushPerekNamePair[]> {
	try {
		const rows = await query<{ perek_id: number; perush_name: string }>(
			`SELECT DISTINCT n.perek_id, p.name AS perush_name
			 FROM note n
			 JOIN perush p ON n.perush_id = p.id
			 ORDER BY n.perek_id ASC, p.name ASC`,
		);
		return rows.map((row) => ({
			perekId: row.perek_id,
			perushName: row.perush_name,
		}));
	} catch (error) {
		console.warn(
			"Failed to fetch perush-perek name pairs:",
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

interface RangedNoteRow extends NoteRow {
	perek_id: number;
}

/**
 * A commentary note anchored to a canonical (perek, pasuk) position —
 * returned by range-based queries where one perush may span perakim.
 */
export interface RangedPerushNote extends PerushNote {
	perekId: number;
}

interface RangePerushRow {
	perush_id: number;
	perush_name: string;
	parshan_name: string;
	perek_id: number;
	note_count: number;
	priority: number;
}

/**
 * A perush summary returned by a range query. `perekId` is the first
 * perek (in range order) carrying notes for this perush — the canonical
 * /929 page to link for the full commentary.
 */
export interface RangePerushSummary extends PerushSummary {
	perekId: number;
}

/**
 * Fetch perushim whose verse-addressed notes fall inside the given
 * canonical ranges — the shared unit->commentary path for reading
 * divisions (מסורה units, פרשה ranges, Haftarot). One row arrives per
 * (perush, perek); results are aggregated per perush, keeping the first
 * perek in range order for its canonical link and summing note counts
 * across overlapping perakim.
 *
 * `noteCount` counts DISTINCT covered pesukim — a pasuk carrying several
 * notes counts once, so the displayed verse total never exceeds the
 * unit's own pesukim (issue #2190).
 */
export async function getPerushimForRanges(
	ranges: ScriptureRange[],
): Promise<RangePerushSummary[]> {
	const slices = slicesForRanges(ranges);
	if (slices.length === 0) return [];
	const { sql, params } = noteSliceCondition(slices);
	try {
		const rows = await query<RangePerushRow>(
			`SELECT
				n.perush_id AS perush_id,
				p.name AS perush_name,
				pa.name AS parshan_name,
				n.perek_id AS perek_id,
				COUNT(DISTINCT n.pasuk) AS note_count,
				p.priority AS priority
			 FROM note n
			 JOIN perush p ON n.perush_id = p.id
			 JOIN parshan pa ON p.parshan_id = pa.id
			 WHERE ${sql}
			 GROUP BY p.id, p.name, pa.name, p.priority, n.perek_id`,
			params,
		);

		const perekOrder = slicePerekOrder(slices);
		const byPerush = new Map<number, RangePerushSummary & { priority: number; firstPerekOrder: number }>();
		for (const row of rows) {
			const order = perekOrder.get(row.perek_id) ?? Number.MAX_SAFE_INTEGER;
			const existing = byPerush.get(row.perush_id);
			if (existing) {
				existing.noteCount += Number(row.note_count);
				if (order < existing.firstPerekOrder) {
					existing.firstPerekOrder = order;
					existing.perekId = row.perek_id;
				}
			} else {
				byPerush.set(row.perush_id, {
					id: row.perush_id,
					name: row.perush_name,
					parshanName: row.parshan_name,
					noteCount: Number(row.note_count),
					priority: row.priority,
					perekId: row.perek_id,
					firstPerekOrder: order,
				});
			}
		}
		return [...byPerush.values()]
			.sort((a, b) => a.priority - b.priority || b.noteCount - a.noteCount)
			.map(({ priority: _priority, firstPerekOrder: _order, ...summary }) => summary);
	} catch (error) {
		console.warn(
			"Failed to fetch perushim for ranges:",
			error instanceof Error ? error.message : error,
		);
		return [];
	}
}

/**
 * Fetch a perush's notes inside canonical ranges, preserving range
 * order across perakim. Verse-addressed notes whose pasuk sits inside
 * the bounds are returned; boundary pesukim shared by two units appear
 * in both units' results.
 */
export async function getPerushNotesForRanges(
	perushId: number,
	ranges: ScriptureRange[],
): Promise<RangedPerushNote[]> {
	const slices = slicesForRanges(ranges);
	if (slices.length === 0) return [];
	const { sql, params } = noteSliceCondition(slices);
	try {
		const rows = await query<RangedNoteRow>(
			`SELECT n.perek_id, n.pasuk, n.note_idx, n.note_content
			 FROM note n
			 WHERE n.perush_id = ? AND (${sql})
			 ORDER BY n.perek_id ASC, n.pasuk ASC, n.note_idx ASC`,
			[perushId, ...params],
		);
		const perekOrder = slicePerekOrder(slices);
		return rows
			.map((row) => ({
				perekId: row.perek_id,
				pasuk: row.pasuk,
				noteIdx: row.note_idx,
				noteContent: row.note_content,
			}))
			.sort((a, b) => {
				const orderA = perekOrder.get(a.perekId) ?? Number.MAX_SAFE_INTEGER;
				const orderB = perekOrder.get(b.perekId) ?? Number.MAX_SAFE_INTEGER;
				return (
					orderA - orderB || a.pasuk - b.pasuk || a.noteIdx - b.noteIdx
				);
			});
	} catch (error) {
		console.warn(
			"Failed to fetch notes for perush %d over ranges:",
			perushId,
			error instanceof Error ? error.message : error,
		);
		return [];
	}
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
