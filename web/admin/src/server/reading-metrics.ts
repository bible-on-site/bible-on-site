/**
 * Write-path maintenance for the shared reading-metrics contract (#2607):
 * the admin is the only article/Tanahpedia-entry writer, so every content
 * save recomputes the stored decoration inside the same transaction — a
 * reader can never meet a metric that describes yesterday's text.
 *
 * Everything degrades on a missing schema: a database that predates the
 * upgrade file keeps serving admin writes exactly as before.
 */
import { createHash } from "node:crypto";
import type mysql from "mysql2/promise";
import {
	countHtmlBlocks,
	estimateReadingSeconds,
	READING_METRICS_CALC_VERSION,
	READING_WORDS_PER_MINUTE,
} from "../../../shared/reading-metrics/index";
import { htmlToPlainText } from "../../../shared/reading-metrics/text";
import { txExecute } from "./db";

/** sha256 hex of the normalized counted text — the stored `source_hash`. */
export function metricSourceHash(countedText: string): string {
	return createHash("sha256").update(countedText, "utf8").digest("hex");
}

/**
 * True when the failure means the reading-metrics schema is not deployed yet.
 * Only the missing-table/missing-column errors may degrade — anything else is
 * a real write failure and must still propagate.
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

interface MetricWrite {
	table: string;
	keyColumn: string;
	key: number | string;
	blocksTable: string;
	blocksKeyColumn: string;
}

/**
 * Shared recompute: count the content, upsert the metric row, and replace the
 * ordered block rows — all inside the caller's transaction so the metric can
 * never commit against content that rolled back.
 */
async function recomputeMetrics(
	conn: mysql.PoolConnection,
	write: MetricWrite,
	contentHtml: string | null,
): Promise<void> {
	const { wordCount, blocks } = countHtmlBlocks(contentHtml);
	const estimatedSeconds = estimateReadingSeconds(wordCount);
	const sourceHash = metricSourceHash(htmlToPlainText(contentHtml ?? ""));

	await txExecute(
		conn,
		`INSERT INTO ${write.table}
			(${write.keyColumn}, word_count, estimated_seconds, words_per_minute, calc_version, source_hash)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
			word_count = VALUES(word_count),
			estimated_seconds = VALUES(estimated_seconds),
			words_per_minute = VALUES(words_per_minute),
			calc_version = VALUES(calc_version),
			source_hash = VALUES(source_hash),
			computed_at = CURRENT_TIMESTAMP`,
		[
			write.key,
			wordCount,
			estimatedSeconds,
			READING_WORDS_PER_MINUTE,
			READING_METRICS_CALC_VERSION,
			sourceHash,
		],
	);

	// Blocks are positional: replace the whole ordered set so stale trailing
	// blocks from a previously longer body cannot survive.
	await txExecute(
		conn,
		`DELETE FROM ${write.blocksTable} WHERE ${write.blocksKeyColumn} = ?`,
		[write.key],
	);
	let cumulative = 0;
	for (const [blockIdx, blockWords] of blocks.entries()) {
		cumulative += blockWords;
		await txExecute(
			conn,
			`INSERT INTO ${write.blocksTable}
				(${write.blocksKeyColumn}, block_idx, word_count, cumulative_words, calc_version)
			 VALUES (?, ?, ?, ?, ?)`,
			[
				write.key,
				blockIdx,
				blockWords,
				cumulative,
				READING_METRICS_CALC_VERSION,
			],
		);
	}
}

/**
 * Recompute an article's stored metric + block rows inside the caller's
 * transaction. No-op when the metrics schema is not deployed.
 */
export async function recomputeArticleMetrics(
	conn: mysql.PoolConnection,
	articleId: number,
	contentHtml: string | null,
): Promise<void> {
	try {
		await recomputeMetrics(
			conn,
			{
				table: "tanah_article_metric",
				keyColumn: "article_id",
				key: articleId,
				blocksTable: "tanah_article_metric_block",
				blocksKeyColumn: "article_id",
			},
			contentHtml,
		);
	} catch (error) {
		if (!isReadingMetricsSchemaMissing(error)) throw error;
	}
}

/**
 * Recompute a Tanahpedia entry's stored metric + block rows inside the
 * caller's transaction. No-op when the metrics schema is not deployed.
 */
export async function recomputeEntryMetrics(
	conn: mysql.PoolConnection,
	entryId: string,
	contentHtml: string | null,
): Promise<void> {
	try {
		await recomputeMetrics(
			conn,
			{
				table: "tanahpedia_entry_metric",
				keyColumn: "entry_id",
				key: entryId,
				blocksTable: "tanahpedia_entry_metric_block",
				blocksKeyColumn: "entry_id",
			},
			contentHtml,
		);
	} catch (error) {
		if (!isReadingMetricsSchemaMissing(error)) throw error;
	}
}
