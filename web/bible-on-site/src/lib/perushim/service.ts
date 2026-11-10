import { query } from "../api-client";
import type { ScriptureRange } from "../reading/contract";
import {
	groupedSliceSelects,
	noteMetricSliceCondition,
	noteSliceCondition,
	slicePerekOrder,
	slicesForRanges,
} from "../reading/queries";
import type { ReadingMetric } from "../reading-metrics";
import {
	getPerushMetric,
	getPerushMetricsByPerekId,
	getPerushMetricsByPerekIds,
	metricOrFallback,
} from "../reading-metrics";
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

		const summaries = rows.map((row) => ({
			id: row.perush_id,
			name: row.perush_name,
			parshanName: row.parshan_name,
			noteCount: Number(row.note_count),
		}));
		// Attach stored perush×perek reading metrics (#2607); a missing schema
		// or uncomputed row leaves `metric` absent (distinct from verified-empty
		// zeros), and a failed metric read must not hide loaded commentaries.
		const metrics = await metricOrFallback(
			`perushim perek ${perekId}`,
			new Map<number, ReadingMetric>(),
			() => getPerushMetricsByPerekId(perekId),
		);
		return summaries.map((summary) => {
			const metric = metrics.get(summary.id);
			return metric ? { ...summary, metric } : summary;
		});
	} catch (error) {
		console.warn(
			"Failed to fetch perushim for perek %d:",
			perekId,
			error instanceof Error ? error.message : error,
		);
		// Reject so a failed fetch cannot become a cached empty list.
		throw error;
	}
}

/**
 * Batch variant of {@link getPerushimByPerekId}: one grouped query for
 * a whole set of perakim (e.g. every perek of a sefer's book view)
 * instead of one query per perek, followed by a single perush-metrics
 * read. Keys are perek ids; a perek with no commentaries has no key.
 */
export async function getPerushimByPerekIds(
	perekIds: number[],
): Promise<Map<number, PerushSummary[]>> {
	const byPerek = new Map<number, PerushSummary[]>();
	if (perekIds.length === 0) return byPerek;
	const placeholders = perekIds.map(() => "?").join(", ");
	try {
		const rows = await query<PerushSummaryRow & { perek_id: number }>(
			`SELECT
				n.perek_id AS perek_id,
				p.id AS perush_id,
				p.name AS perush_name,
				pa.name AS parshan_name,
				COUNT(*) AS note_count,
				p.priority AS priority
			 FROM note n
			 JOIN perush p ON n.perush_id = p.id
			 JOIN parshan pa ON p.parshan_id = pa.id
			 WHERE n.perek_id IN (${placeholders})
			 GROUP BY n.perek_id, p.id, p.name, pa.name, p.priority
			 ORDER BY n.perek_id ASC, p.priority ASC, note_count DESC`,
			perekIds,
		);

		const metrics = await metricOrFallback(
			`perushim (${perekIds.length} perakim)`,
			new Map<number, Map<number, ReadingMetric>>(),
			() => getPerushMetricsByPerekIds(perekIds),
		);
		for (const row of rows) {
			const metric = metrics.get(row.perek_id)?.get(row.perush_id);
			const summary: PerushSummary = {
				id: row.perush_id,
				name: row.perush_name,
				parshanName: row.parshan_name,
				noteCount: Number(row.note_count),
				...(metric ? { metric } : {}),
			};
			const list = byPerek.get(row.perek_id) ?? [];
			list.push(summary);
			byPerek.set(row.perek_id, list);
		}
		return byPerek;
	} catch (error) {
		console.warn(
			"Failed to fetch perushim for %d perakim:",
			perekIds.length,
			error instanceof Error ? error.message : error,
		);
		// Reject so a failed fetch cannot become a cached empty list.
		throw error;
	}
}

interface PerushPerekNamePair {
	perekId: number;
	perushName: string;
}

/** Build enumeration must fail on database errors rather than publish missing routes. */
export async function getAllPerushPerekNamePairs(): Promise<
	PerushPerekNamePair[]
> {
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
		throw error;
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
	/**
	 * Stored `tanah_note_metric` word count for this note (#3108).
	 * Absent/`null` when the metric row is missing or the metric read
	 * degraded — one uncounted note makes the whole range's
	 * metric unknown (`rangedPerushMetrics`).
	 */
	wordCount?: number | null;
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
		const byPerush = new Map<
			number,
			RangePerushSummary & { priority: number; firstPerekOrder: number }
		>();
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
			.map(
				({ priority: _priority, firstPerekOrder: _order, ...summary }) =>
					summary,
			);
	} catch (error) {
		console.warn(
			"Failed to fetch perushim for ranges:",
			error instanceof Error ? error.message : error,
		);
		// Reject so a failed fetch cannot become a cached empty list.
		throw error;
	}
}

interface GroupedRangePerushRow extends RangePerushRow {
	unit_order: number;
	first_slice_order: number;
}

/**
 * Batch variant of {@link getPerushimForRanges}: one grouped query for
 * several range lists (e.g. every unit of an alternative-division
 * sefer book, issue #2191) instead of one query per unit. Element i of
 * the result holds the perush summaries for `rangeGroups[i]` under the
 * same aggregation and ordering semantics — a boundary pasuk shared by
 * two units counts in both.
 */
export async function getPerushimForRangeGroups(
	rangeGroups: ScriptureRange[][],
): Promise<RangePerushSummary[][]> {
	const sliceGroups = rangeGroups.map(slicesForRanges);
	const byUnit = rangeGroups.map(
		() =>
			new Map<
				number,
				RangePerushSummary & { priority: number; firstSliceOrder: number }
			>(),
	);
	if (sliceGroups.every((slices) => slices.length === 0)) {
		return byUnit.map(() => []);
	}
	const slicesTable = groupedSliceSelects(sliceGroups);
	try {
		const rows = await query<GroupedRangePerushRow>(
			`SELECT
				sm.unit_order AS unit_order,
				MIN(sm.slice_order) AS first_slice_order,
				n.perush_id AS perush_id,
				p.name AS perush_name,
				pa.name AS parshan_name,
				n.perek_id AS perek_id,
				COUNT(DISTINCT n.pasuk) AS note_count,
				p.priority AS priority
			 FROM note n
			 JOIN perush p ON n.perush_id = p.id
			 JOIN parshan pa ON p.parshan_id = pa.id
			 JOIN (${slicesTable.sql}) sm
				ON n.perek_id = sm.perek_id
				AND n.pasuk BETWEEN sm.start_pasuk AND sm.end_pasuk
			 GROUP BY sm.unit_order, p.id, p.name, pa.name, p.priority, n.perek_id`,
			slicesTable.params,
		);

		for (const row of rows) {
			const byPerush = byUnit[row.unit_order];
			if (!byPerush) continue;
			const order = Number(row.first_slice_order);
			const existing = byPerush.get(row.perush_id);
			if (existing) {
				existing.noteCount += Number(row.note_count);
				if (order < existing.firstSliceOrder) {
					existing.firstSliceOrder = order;
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
					firstSliceOrder: order,
				});
			}
		}
		return byUnit.map((byPerush) =>
			[...byPerush.values()]
				.sort((a, b) => a.priority - b.priority || b.noteCount - a.noteCount)
				.map(
					({ priority: _priority, firstSliceOrder: _order, ...summary }) =>
						summary,
				),
		);
	} catch (error) {
		console.warn(
			"Failed to fetch perushim for range groups:",
			error instanceof Error ? error.message : error,
		);
		// Reject so a failed fetch cannot become a cached empty list.
		throw error;
	}
}

interface NoteMetricRow {
	perek_id: number;
	pasuk: number;
	note_idx: number;
	word_count: number;
}

/**
 * Fetch a perush's notes inside canonical ranges, preserving range
 * order across perakim. Verse-addressed notes whose pasuk sits inside
 * the bounds are returned; boundary pesukim shared by two units appear
 * in both units' results.
 *
 * Each note carries its stored `tanah_note_metric` word count when the
 * row exists (#3108) — the ranged readers aggregate those counts into
 * the range's own estimate and progress units (`rangedPerushMetrics`).
 * The counts ride a second, purely decorative read that degrades on ANY
 * failure (`metricOrFallback` semantics): the notes query is the
 * pre-metrics path verbatim and still owns this fetch's failure
 * contract — a broken or missing metrics table can never hide the
 * commentary itself.
 */
export async function getPerushNotesForRanges(
	perushId: number,
	ranges: ScriptureRange[],
): Promise<RangedPerushNote[]> {
	const slices = slicesForRanges(ranges);
	if (slices.length === 0) return [];
	const { sql, params } = noteSliceCondition(slices);
	const { sql: metricCond, params: metricParams } =
		noteMetricSliceCondition(slices);
	try {
		const [rows, metricRows] = await Promise.all([
			query<RangedNoteRow>(
				`SELECT n.perek_id, n.pasuk, n.note_idx, n.note_content
				 FROM note n
				 WHERE n.perush_id = ? AND (${sql})
				 ORDER BY n.perek_id ASC, n.pasuk ASC, n.note_idx ASC`,
				[perushId, ...params],
			),
			query<NoteMetricRow>(
				`SELECT m.perek_id, m.pasuk, m.note_idx, m.word_count
				 FROM tanah_note_metric m
				 WHERE m.perush_id = ? AND (${metricCond})`,
				[perushId, ...metricParams],
			).catch((error: unknown) => {
				console.warn(
					"Reading metrics unavailable; " +
						"serving ranged commentary without estimates:",
					error instanceof Error ? error.message : error,
				);
				return [] as NoteMetricRow[];
			}),
		]);
		const wordCountByKey = new Map<string, number>();
		for (const row of metricRows) {
			wordCountByKey.set(
				`${row.perek_id}:${row.pasuk}:${row.note_idx}`,
				Number(row.word_count),
			);
		}
		const perekOrder = slicePerekOrder(slices);
		return rows
			.map((row) => {
				const wordCount = wordCountByKey.get(
					`${row.perek_id}:${row.pasuk}:${row.note_idx}`,
				);
				return {
					perekId: row.perek_id,
					pasuk: row.pasuk,
					noteIdx: row.note_idx,
					noteContent: row.note_content,
					...(wordCount != null ? { wordCount } : {}),
				};
			})
			.sort((a, b) => {
				const orderA = perekOrder.get(a.perekId) ?? Number.MAX_SAFE_INTEGER;
				const orderB = perekOrder.get(b.perekId) ?? Number.MAX_SAFE_INTEGER;
				return orderA - orderB || a.pasuk - b.pasuk || a.noteIdx - b.noteIdx;
			});
	} catch (error) {
		console.warn(
			"Failed to fetch notes for perush %d over ranges:",
			perushId,
			error instanceof Error ? error.message : error,
		);
		// Reject so a failed fetch cannot become a cached empty list.
		throw error;
	}
}

/**
 * Fetch a named perush's notes for a single pasuk in one indexed lookup —
 * the hover-preview path needs only this pasuk, not the perush's whole
 * perek notes nor the perek summary + metrics queries.
 * Empty result when the perush is unknown or has no notes on the pasuk.
 */
export async function getPerushNotesForPasuk(
	perushName: string,
	perekId: number,
	pasuk: number,
): Promise<PerushNote[]> {
	try {
		const rows = await query<NoteRow>(
			`SELECT n.pasuk, n.note_idx, n.note_content
			 FROM note n
			 JOIN perush p ON n.perush_id = p.id
			 WHERE p.name = ? AND n.perek_id = ? AND n.pasuk = ?
			 ORDER BY n.note_idx ASC`,
			[perushName, perekId, pasuk],
		);

		return rows.map((row) => ({
			pasuk: row.pasuk,
			noteIdx: row.note_idx,
			noteContent: row.note_content,
		}));
	} catch (error) {
		console.warn(
			"Failed to fetch notes for perush %s perek %d pasuk %d:",
			perushName,
			perekId,
			pasuk,
			error instanceof Error ? error.message : error,
		);
		// Reject so a failed fetch cannot become a cached empty list.
		throw error;
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
		// Reject so a failed fetch cannot become a cached empty list.
		throw error;
	}
}

/**
 * Fetch notes for several perushim on one perek in a single query — the
 * Sefer commentary panel renders every selected perush at once, so one
 * round trip beats one request per perush. Keys are perush ids; a perush
 * with no notes on the perek simply has no key.
 */
export async function getPerushNotesBatch(
	perekId: number,
	perushIds: number[],
): Promise<Record<number, PerushNote[]>> {
	const ids = [...new Set(perushIds)].filter(
		(id) => Number.isInteger(id) && id > 0,
	);
	if (ids.length === 0) return {};
	try {
		// One placeholder per id: `execute` binds each `?` to a scalar, so a
		// single `IN (?)` would receive the array as one JSON-encoded value
		// and match nothing.
		const placeholders = ids.map(() => "?").join(",");
		const rows = await query<NoteRow & { perush_id: number }>(
			`SELECT perush_id, pasuk, note_idx, note_content
			 FROM note
			 WHERE perek_id = ? AND perush_id IN (${placeholders})
			 ORDER BY perush_id ASC, pasuk ASC, note_idx ASC`,
			[perekId, ...ids],
		);
		const byPerush: Record<number, PerushNote[]> = {};
		for (const row of rows) {
			const notes = byPerush[row.perush_id] ?? [];
			notes.push({
				pasuk: row.pasuk,
				noteIdx: row.note_idx,
				noteContent: row.note_content,
			});
			byPerush[row.perush_id] = notes;
		}
		return byPerush;
	} catch (error) {
		console.warn(
			"Failed to fetch notes batch for perek %d:",
			perekId,
			error instanceof Error ? error.message : error,
		);
		// Reject so a failed fetch cannot become a cached empty panel.
		throw error;
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
			parshan_id: number;
			parshan_name: string;
			parshan_birth_year: number | null;
		}>(
			`SELECT p.name AS perush_name, p.parshan_id, pa.name AS parshan_name, pa.birth_year AS parshan_birth_year
			 FROM perush p
			 JOIN parshan pa ON p.parshan_id = pa.id
			 WHERE p.id = ?`,
			[perushId],
		);

		if (metaRows.length === 0) return null;

		const notes = await getPerushNotes(perushId, perekId);
		// Optional decoration: a failed metric read keeps the loaded detail.
		const metric = await metricOrFallback(
			`perush ${perushId} perek ${perekId}`,
			null,
			() => getPerushMetric(perushId, perekId),
		);
		const r = metaRows[0];

		return {
			id: perushId,
			name: r.perush_name,
			parshanId: r.parshan_id,
			parshanName: r.parshan_name,
			...(r.parshan_birth_year != null && {
				parshanBirthYear: r.parshan_birth_year,
			}),
			...(metric ? { metric } : {}),
			notes,
		};
	} catch (error) {
		console.warn(
			"Failed to fetch perush detail %d:",
			perushId,
			error instanceof Error ? error.message : error,
		);
		// Reject so a failed fetch cannot become a cached false 404.
		throw error;
	}
}
