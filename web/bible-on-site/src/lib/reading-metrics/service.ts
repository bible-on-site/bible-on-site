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
import type { ReadingMetric } from "./types";

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
