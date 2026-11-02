/**
 * Server-side reads for the shared reading-metrics contract (#2607).
 *
 * The metric tables are written by the data deploy
 * (`data/mysql/tanah_reading_metrics_upgrade.sql`) and maintained by admin
 * content writes plus `web/admin/scripts/backfill-reading-metrics.mts`.
 * The website ships independently of Data CD and prerenders against
 * production RDS, so a database that predates the migration reports
 * missing-table/missing-column errors — those (and only those) degrade to
 * "metric unknown" instead of failing the render.
 */
import "server-only";

import { query } from "../api-client";
import type { ReadingMetric, ReadingProgressUnit } from "./types";

interface MetricRow {
	word_count: number | null;
	estimated_seconds: number | null;
}

const METRIC_SELECT = "word_count, estimated_seconds";

function toMetric(row: MetricRow): ReadingMetric {
	return {
		wordCount: row.word_count,
		estimatedSeconds: row.estimated_seconds,
	};
}

interface UnitRow {
	word_count: number;
	cumulative_words: number;
}

function toUnit(key: string | null, row: UnitRow): ReadingProgressUnit {
	return {
		key,
		wordCount: row.word_count,
		cumulativeWords: row.cumulative_words,
	};
}

/**
 * Whether a rejection means the reading-metrics schema is not deployed yet.
 * Mirrors `isCoveringSourceSchemaMissing` semantics in articles/service.
 */
export function isReadingMetricsSchemaMissing(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const { code, errno } = error as { code?: unknown; errno?: unknown };
	return (
		code === "ER_NO_SUCH_TABLE" ||
		code === "ER_BAD_FIELD_ERROR" ||
		errno === 1146 ||
		errno === 1054
	);
}

/** Wrap a metric query: missing schema → fallback, anything else → throw. */
async function orMetricMissing<T>(
	run: () => Promise<T>,
	fallback: T,
): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (!isReadingMetricsSchemaMissing(error)) throw error;
		return fallback;
	}
}

/**
 * Run a metric read whose result only decorates real content. Missing-schema
 * rejections never reach this catch (the getters already degrade them); any
 * other failure logs and yields `fallback` so a flaky metric query cannot
 * hide the commentaries, articles or entries it was decorating.
 */
export async function metricOrFallback<T>(
	label: string,
	fallback: T,
	read: () => Promise<T>,
): Promise<T> {
	try {
		return await read();
	} catch (error) {
		console.warn(
			"Reading metric read failed; continuing without estimates:",
			label,
			error instanceof Error ? error.message : error,
		);
		return fallback;
	}
}

/** Stored metric for a whole perek (`/929/[number]`). */
export async function getPerekMetric(
	perekId: number,
): Promise<ReadingMetric | null> {
	const rows = await orMetricMissing(
		() =>
			query<MetricRow>(
				`SELECT ${METRIC_SELECT} FROM tanah_perek_metric WHERE perek_id = ?`,
				[perekId],
			),
		[],
	);
	const [row] = rows;
	return row ? toMetric(row) : null;
}

/** Stored metrics keyed by perek id — one read for a whole sefer (#2607). */
export async function getPerekMetrics(
	perekIds: number[],
): Promise<Map<number, ReadingMetric>> {
	if (perekIds.length === 0) return new Map();
	const placeholders = perekIds.map(() => "?").join(", ");
	const rows = await orMetricMissing(
		() =>
			query<MetricRow & { perek_id: number }>(
				`SELECT perek_id, ${METRIC_SELECT}
				 FROM tanah_perek_metric WHERE perek_id IN (${placeholders})`,
				perekIds,
			),
		[],
	);
	return new Map(rows.map((r) => [r.perek_id, toMetric(r)]));
}

/** Stored metrics keyed by article id for arbitrary id sets. */
export async function getArticleMetrics(
	articleIds: number[],
): Promise<Map<number, ReadingMetric>> {
	if (articleIds.length === 0) return new Map();
	const placeholders = articleIds.map(() => "?").join(", ");
	const rows = await orMetricMissing(
		() =>
			query<MetricRow & { article_id: number }>(
				`SELECT article_id, ${METRIC_SELECT}
				 FROM tanah_article_metric WHERE article_id IN (${placeholders})`,
				articleIds,
			),
		[],
	);
	return new Map(rows.map((r) => [r.article_id, toMetric(r)]));
}

/** Stored metrics for every perush covering a perek. */
export async function getPerushMetricsByPerekId(
	perekId: number,
): Promise<Map<number, ReadingMetric>> {
	const rows = await orMetricMissing(
		() =>
			query<MetricRow & { perush_id: number }>(
				`SELECT perush_id, ${METRIC_SELECT}
				 FROM tanah_perush_metric WHERE perek_id = ?`,
				[perekId],
			),
		[],
	);
	return new Map(rows.map((r) => [r.perush_id, toMetric(r)]));
}

/** Stored metric for one perush on one perek. */
export async function getPerushMetric(
	perushId: number,
	perekId: number,
): Promise<ReadingMetric | null> {
	const rows = await orMetricMissing(
		() =>
			query<MetricRow>(
				`SELECT ${METRIC_SELECT} FROM tanah_perush_metric
				 WHERE perush_id = ? AND perek_id = ?`,
				[perushId, perekId],
			),
		[],
	);
	const [row] = rows;
	return row ? toMetric(row) : null;
}

/** Stored metric for a Tanahpedia entry. */
export async function getEntryMetric(
	entryId: string,
): Promise<ReadingMetric | null> {
	const rows = await orMetricMissing(
		() =>
			query<MetricRow>(
				`SELECT ${METRIC_SELECT} FROM tanahpedia_entry_metric WHERE entry_id = ?`,
				[entryId],
			),
		[],
	);
	const [row] = rows;
	return row ? toMetric(row) : null;
}

/* ── Ordered progress units (word-weighted reading-position, #2607) ── */

const UNIT_SELECT = "word_count, cumulative_words";

/**
 * Stored per-pasuk units for one perek, in canonical order. Keys are pasuk
 * numbers so a GUI maps `#pasuk-N` / `[data-sefer-pasuk]` elements to rows.
 */
export async function getPerekProgressUnits(
	perekId: number,
): Promise<ReadingProgressUnit[]> {
	const rows = await orMetricMissing(
		() =>
			query<UnitRow & { pasuk: number }>(
				`SELECT pasuk, ${UNIT_SELECT} FROM tanah_perek_pasuk_metric
				 WHERE perek_id = ? ORDER BY pasuk`,
				[perekId],
			),
		[],
	);
	return rows.map((r) => toUnit(String(r.pasuk), r));
}

/**
 * Stored per-pasuk units for many perakim in one query — the Sefer view
 * renders every perek of the book at once, so one batched read replaces a
 * request per page.
 */
export async function getPerekProgressUnitsBatch(
	perekIds: number[],
): Promise<Map<number, ReadingProgressUnit[]>> {
	if (perekIds.length === 0) return new Map();
	const placeholders = perekIds.map(() => "?").join(", ");
	const rows = await orMetricMissing(
		() =>
			query<UnitRow & { perek_id: number; pasuk: number }>(
				`SELECT perek_id, pasuk, ${UNIT_SELECT} FROM tanah_perek_pasuk_metric
				 WHERE perek_id IN (${placeholders})
				 ORDER BY perek_id, pasuk`,
				perekIds,
			),
		[],
	);
	const byPerek = new Map<number, ReadingProgressUnit[]>();
	for (const row of rows) {
		const list = byPerek.get(row.perek_id) ?? [];
		list.push(toUnit(String(row.pasuk), row));
		byPerek.set(row.perek_id, list);
	}
	return byPerek;
}

/**
 * Stored readable-block units for one article, in document order. Blocks
 * carry no element key — the GUI locates the i-th non-empty readable
 * segment inside the rendered body and aligns it with `block_idx` i.
 */
export async function getArticleProgressUnits(
	articleId: number,
): Promise<ReadingProgressUnit[]> {
	const rows = await orMetricMissing(
		() =>
			query<UnitRow & { block_idx: number }>(
				`SELECT block_idx, ${UNIT_SELECT} FROM tanah_article_metric_block
				 WHERE article_id = ? ORDER BY block_idx`,
				[articleId],
			),
		[],
	);
	return rows.map((r) => toUnit(null, r));
}

/**
 * Stored readable-block units for one Tanahpedia entry, same positional
 * contract as {@link getArticleProgressUnits}.
 */
export async function getEntryProgressUnits(
	entryId: string,
): Promise<ReadingProgressUnit[]> {
	const rows = await orMetricMissing(
		() =>
			query<UnitRow & { block_idx: number }>(
				`SELECT block_idx, ${UNIT_SELECT} FROM tanahpedia_entry_metric_block
				 WHERE entry_id = ? ORDER BY block_idx`,
				[entryId],
			),
		[],
	);
	return rows.map((r) => toUnit(null, r));
}

/**
 * Stored note units for one perush on one perek, ordered by
 * (pasuk, note_idx). Keys are `pasuk:noteIdx` so a GUI maps
 * `[data-perush-pasuk][data-perush-note]` elements to rows.
 */
export async function getPerushProgressUnits(
	perushId: number,
	perekId: number,
): Promise<ReadingProgressUnit[]> {
	const rows = await orMetricMissing(
		() =>
			query<UnitRow & { pasuk: number; note_idx: number }>(
				`SELECT pasuk, note_idx, ${UNIT_SELECT} FROM tanah_note_metric
				 WHERE perush_id = ? AND perek_id = ?
				 ORDER BY pasuk, note_idx`,
				[perushId, perekId],
			),
		[],
	);
	return rows.map((r) => toUnit(`${r.pasuk}:${r.note_idx}`, r));
}

/**
 * Stored note units for several perushim on one perek in a single query —
 * the Sefer commentary pane shows every selected perush at once and each
 * rendered note element maps to its own stored unit.
 */
export async function getPerushProgressUnitsBatch(
	perekId: number,
	perushIds: number[],
): Promise<Map<number, ReadingProgressUnit[]>> {
	if (perushIds.length === 0) return new Map();
	const placeholders = perushIds.map(() => "?").join(", ");
	const rows = await orMetricMissing(
		() =>
			query<UnitRow & { perush_id: number; pasuk: number; note_idx: number }>(
				`SELECT perush_id, pasuk, note_idx, ${UNIT_SELECT} FROM tanah_note_metric
				 WHERE perek_id = ? AND perush_id IN (${placeholders})
				 ORDER BY perush_id, pasuk, note_idx`,
				[perekId, ...perushIds],
			),
		[],
	);
	const byPerush = new Map<number, ReadingProgressUnit[]>();
	for (const row of rows) {
		const list = byPerush.get(row.perush_id) ?? [];
		list.push(toUnit(`${row.pasuk}:${row.note_idx}`, row));
		byPerush.set(row.perush_id, list);
	}
	return byPerush;
}
