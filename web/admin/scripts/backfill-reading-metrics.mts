/**
 * Backfill the shared reading-metrics contract (#2607) into an existing
 * database. Idempotent: a row whose stored (source_hash, calc_version) still
 * matches is left untouched, so unchanged reruns write nothing; changed
 * content, fresh databases, and counting-policy bumps recompute cleanly.
 *
 * Sources:
 * - perek:   the canonical tanah-view corpus JSON (the artifact the website
 *            bundles), counted once at pasuk granularity.
 * - article: tanah_article.content (HTML), readable-block granularity.
 * - perush:  note.note_content (HTML), note granularity; perush×perek totals
 *            aggregate the member notes in canonical order.
 * - entry:   tanahpedia_entry.content (HTML), readable-block granularity.
 *
 * Batches are bounded and ordered by primary key so a long run is resumable.
 * After the perush pass, metric rows whose source notes (or whole
 * perush×perek groups) were removed by a later import are pruned — the note
 * coordinate tables carry no FK, so nothing else cleans them up.
 *
 * The website caches content indefinitely and only re-renders on
 * `/api/revalidate`, so kinds that actually wrote rows trigger the matching
 * tag/path invalidations afterwards (same contract as
 * src/server/website-revalidate.ts).
 *
 * Usage (from web/admin):
 *   bun run scripts/backfill-reading-metrics.mts
 *   bun run scripts/backfill-reading-metrics.mts --kinds perek --force
 * Env: DB_URL (defaults per src/server/db-config.ts) — run against a
 * sync-from-prod snapshot. VITE_WEBSITE_URL + REVALIDATE_SECRET enable the
 * post-backfill website invalidation.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ResultSetHeader } from "mysql2";
import mysql from "mysql2/promise";
import {
	countHtmlBlocks,
	countTextWords,
	estimateReadingSeconds,
	htmlToPlainText,
	pasukCountedText,
	READING_METRICS_CALC_VERSION,
	READING_WORDS_PER_MINUTE,
} from "../../shared/reading-metrics/index";
import type { CorpusPasuk } from "../../shared/reading-metrics/perek";

const adminDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const DEFAULT_TANAH_VIEW = resolve(
	adminDir,
	"..",
	"bible-on-site",
	"src",
	"data",
	"db",
	"sefaria-dump-5784-sivan-4.tanah_view.json",
);

const { values: args } = parseArgs({
	options: {
		"tanah-view": { type: "string", default: DEFAULT_TANAH_VIEW },
		kinds: { type: "string", default: "perek,article,perush,entry" },
		batch: { type: "string", default: "500" },
		force: { type: "boolean", default: false },
	},
});

const BATCH = Math.max(1, Number.parseInt(args.batch ?? "500", 10) || 500);
const kinds = new Set(
	(args.kinds ?? "perek,article,perush,entry").split(",").map((k) => k.trim()),
);
const force = args.force === true;

/** Minimal queryable shape shared by Pool and PoolConnection. */
interface Executor {
	execute(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

function executor(conn: mysql.PoolConnection | mysql.Pool): Executor {
	const exec = conn.execute.bind(conn) as (
		sql: string,
		params?: unknown[],
	) => Promise<[unknown, unknown]>;
	return { execute: exec };
}

const dbUrl =
	process.env.DB_URL ?? "mysql://root:test_123@localhost:3306/tanah-dev";
const pool = mysql.createPool(dbUrl);
const db = executor(pool);

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/** A metric row is fresh only when both the content hash and policy match. */
function rowIsFresh(
	row: { source_hash: string; calc_version: number } | undefined,
	hash: string,
): boolean {
	return (
		!force &&
		row !== undefined &&
		row.source_hash === hash &&
		row.calc_version === READING_METRICS_CALC_VERSION
	);
}

/** Upsert a single-key metric row (INSERT … ON DUPLICATE KEY UPDATE). */
async function upsertMetric(
	conn: Executor,
	table: string,
	keyCol: string,
	key: number | string,
	wordCount: number,
	hash: string,
): Promise<void> {
	await conn.execute(
		`INSERT INTO ${table}
			(${keyCol}, word_count, estimated_seconds, words_per_minute, calc_version, source_hash)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
			word_count = VALUES(word_count), estimated_seconds = VALUES(estimated_seconds),
			words_per_minute = VALUES(words_per_minute), calc_version = VALUES(calc_version),
			source_hash = VALUES(source_hash), computed_at = CURRENT_TIMESTAMP`,
		[
			key,
			wordCount,
			estimateReadingSeconds(wordCount),
			READING_WORDS_PER_MINUTE,
			READING_METRICS_CALC_VERSION,
			hash,
		],
	);
}

/**
 * Upsert the perush×perek totals row — the one two-key metric table.
 */
async function upsertPerushMetric(
	conn: Executor,
	perushId: number,
	perekId: number,
	wordCount: number,
	hash: string,
): Promise<void> {
	await conn.execute(
		`INSERT INTO tanah_perush_metric
			(perush_id, perek_id, word_count, estimated_seconds, words_per_minute, calc_version, source_hash)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
			word_count = VALUES(word_count), estimated_seconds = VALUES(estimated_seconds),
			words_per_minute = VALUES(words_per_minute), calc_version = VALUES(calc_version),
			source_hash = VALUES(source_hash), computed_at = CURRENT_TIMESTAMP`,
		[
			perushId,
			perekId,
			wordCount,
			estimateReadingSeconds(wordCount),
			READING_WORDS_PER_MINUTE,
			READING_METRICS_CALC_VERSION,
			hash,
		],
	);
}

/** Replace a content item's whole ordered block set (block_idx positional). */
async function replaceBlocks(
	conn: Executor,
	table: string,
	keyCol: string,
	key: number | string,
	blocks: number[],
): Promise<void> {
	await conn.execute(`DELETE FROM ${table} WHERE ${keyCol} = ?`, [key]);
	let cumulative = 0;
	for (const [idx, count] of blocks.entries()) {
		cumulative += count;
		await conn.execute(
			`INSERT INTO ${table} (${keyCol}, block_idx, word_count, cumulative_words, calc_version)
			 VALUES (?, ?, ?, ?, ?)`,
			[key, idx, count, cumulative, READING_METRICS_CALC_VERSION],
		);
	}
}

/** Stored (hash, version) for every row of a single-key metric table. */
async function storedHashes(
	table: string,
	keyCol: string,
): Promise<Map<string, { source_hash: string; calc_version: number }>> {
	const [rows] = await db.execute(
		`SELECT ${keyCol} AS k, source_hash, calc_version FROM ${table}`,
		[],
	);
	const map = new Map<string, { source_hash: string; calc_version: number }>();
	for (const r of rows as {
		k: number | string;
		source_hash: string;
		calc_version: number;
	}[]) {
		map.set(String(r.k), {
			source_hash: r.source_hash,
			calc_version: r.calc_version,
		});
	}
	return map;
}

// ---------------------------------------------------------------------------
// perek — canonical corpus at pasuk granularity
// ---------------------------------------------------------------------------

interface TanahViewPerek {
	perekId: number;
	pesukim: CorpusPasuk[];
}
interface TanahViewSefer {
	perakim?: TanahViewPerek[];
	additionals?: { perakim: TanahViewPerek[] }[];
}

/** Rows written; callers use it to decide website revalidation. */
async function backfillPerakim(): Promise<number> {
	const corpus = JSON.parse(
		readFileSync(args["tanah-view"], "utf8"),
	) as TanahViewSefer[];
	const perakim: TanahViewPerek[] = [];
	for (const sefer of corpus) {
		if (sefer.perakim) perakim.push(...sefer.perakim);
		for (const add of sefer.additionals ?? []) perakim.push(...add.perakim);
	}
	perakim.sort((a, b) => a.perekId - b.perekId);
	console.log(`perek: ${perakim.length} perakim in corpus`);

	const existing = await storedHashes("tanah_perek_metric", "perek_id");
	let written = 0;
	let unchanged = 0;
	for (const perek of perakim) {
		const texts = perek.pesukim.map(pasukCountedText);
		const hash = sha256(texts.join("\n"));
		if (rowIsFresh(existing.get(String(perek.perekId)), hash)) {
			unchanged += 1;
			continue;
		}
		const pasukCounts = texts.map((t) => countTextWords(t));
		const total = pasukCounts.reduce((s, c) => s + c, 0);
		const conn = await pool.getConnection();
		try {
			await conn.beginTransaction();
			await upsertMetric(
				executor(conn),
				"tanah_perek_metric",
				"perek_id",
				perek.perekId,
				total,
				hash,
			);
			// Pasuk rows play the block-table role; the unit key is `pasuk`.
			await executor(conn).execute(
				"DELETE FROM tanah_perek_pasuk_metric WHERE perek_id = ?",
				[perek.perekId],
			);
			let cumulative = 0;
			for (const [i, count] of pasukCounts.entries()) {
				cumulative += count;
				await executor(conn).execute(
					`INSERT INTO tanah_perek_pasuk_metric (perek_id, pasuk, word_count, cumulative_words, calc_version)
					 VALUES (?, ?, ?, ?, ?)`,
					[
						perek.perekId,
						i + 1,
						count,
						cumulative,
						READING_METRICS_CALC_VERSION,
					],
				);
			}
			await conn.commit();
			written += 1;
		} catch (err) {
			await conn.rollback();
			throw err;
		} finally {
			conn.release();
		}
	}
	console.log(`perek: ${written} written, ${unchanged} unchanged`);
	return written;
}

// ---------------------------------------------------------------------------
// article / entry — HTML bodies at readable-block granularity
// ---------------------------------------------------------------------------

/** Rows written; callers use it to decide website revalidation. */
async function backfillHtmlContent(opts: {
	name: string;
	table: string;
	keyCol: string;
	metricTable: string;
	metricKeyCol: string;
	blocksTable: string;
	keyIsNumeric: boolean;
}): Promise<number> {
	const existing = await storedHashes(opts.metricTable, opts.metricKeyCol);
	let lastKey: number | string = opts.keyIsNumeric ? 0 : "";
	let written = 0;
	let unchanged = 0;
	for (;;) {
		const [rows] = await db.execute(
			`SELECT ${opts.keyCol} AS k, content FROM ${opts.table}
			 WHERE ${opts.keyCol} > ? ORDER BY ${opts.keyCol} LIMIT ${BATCH}`,
			[lastKey],
		);
		const batch = rows as { k: number | string; content: string | null }[];
		if (batch.length === 0) break;
		for (const row of batch) {
			const html = row.content ?? "";
			const { wordCount, blocks } = countHtmlBlocks(html);
			const hash = sha256(htmlToPlainText(html));
			if (rowIsFresh(existing.get(String(row.k)), hash)) {
				unchanged += 1;
			} else {
				const conn = await pool.getConnection();
				try {
					await conn.beginTransaction();
					await upsertMetric(
						executor(conn),
						opts.metricTable,
						opts.metricKeyCol,
						row.k,
						wordCount,
						hash,
					);
					await replaceBlocks(
						executor(conn),
						opts.blocksTable,
						opts.metricKeyCol,
						row.k,
						blocks,
					);
					await conn.commit();
					written += 1;
				} catch (err) {
					await conn.rollback();
					throw err;
				} finally {
					conn.release();
				}
			}
			lastKey = row.k;
		}
		if (batch.length < BATCH) break;
	}
	console.log(`${opts.name}: ${written} written, ${unchanged} unchanged`);
	return written;
}

// ---------------------------------------------------------------------------
// perush — per-note counts plus per (perush, perek) totals
// ---------------------------------------------------------------------------

/** Rows touched (written or pruned); callers use it to decide revalidation. */
async function backfillPerushim(): Promise<number> {
	const existingTotals = new Map<
		string,
		{ source_hash: string; calc_version: number }
	>();
	{
		const [rows] = await db.execute(
			"SELECT perush_id, perek_id, source_hash, calc_version FROM tanah_perush_metric",
			[],
		);
		for (const r of rows as {
			perush_id: number;
			perek_id: number;
			source_hash: string;
			calc_version: number;
		}[]) {
			existingTotals.set(`${r.perush_id}:${r.perek_id}`, {
				source_hash: r.source_hash,
				calc_version: r.calc_version,
			});
		}
	}

	let last = { perush: 0, perek: 0, pasuk: 0, note_idx: 0 };
	let notesWritten = 0;
	let totalsWritten = 0;
	let totalsUnchanged = 0;

	// (perush,perek) groups are contiguous under the PK ordering, so a group is
	// complete the moment the key changes — regardless of batch boundaries.
	let groupKey = "";
	let groupPerush = 0;
	let groupPerek = 0;
	let groupHashes: string[] = [];
	let groupWords = 0;

	const flushGroup = async () => {
		if (groupKey === "") return;
		const hash = sha256(groupHashes.join("\n"));
		if (rowIsFresh(existingTotals.get(groupKey), hash)) {
			totalsUnchanged += 1;
		} else {
			await upsertPerushMetric(db, groupPerush, groupPerek, groupWords, hash);
			totalsWritten += 1;
		}
	};

	for (;;) {
		const [rows] = await db.execute(
			`SELECT perush_id, perek_id, pasuk, note_idx, note_content
			 FROM note
			 WHERE (perush_id, perek_id, pasuk, note_idx) > (?, ?, ?, ?)
			 ORDER BY perush_id, perek_id, pasuk, note_idx
			 LIMIT ${BATCH}`,
			[last.perush, last.perek, last.pasuk, last.note_idx],
		);
		const notes = rows as {
			perush_id: number;
			perek_id: number;
			pasuk: number;
			note_idx: number;
			note_content: string;
		}[];
		if (notes.length === 0) break;

		for (const note of notes) {
			const key = `${note.perush_id}:${note.perek_id}`;
			if (key !== groupKey) {
				await flushGroup();
				groupKey = key;
				groupPerush = note.perush_id;
				groupPerek = note.perek_id;
				groupHashes = [];
				groupWords = 0;
			}
			const { wordCount } = countHtmlBlocks(note.note_content);
			const hash = sha256(htmlToPlainText(note.note_content));
			groupHashes.push(hash);
			groupWords += wordCount;
			// cumulative_words is group-positional, so a mid-group insertion
			// legitimately rewrites later notes: upsert unconditionally.
			await db.execute(
				`INSERT INTO tanah_note_metric
					(perush_id, perek_id, pasuk, note_idx, word_count, cumulative_words, calc_version, source_hash)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 ON DUPLICATE KEY UPDATE
					word_count = VALUES(word_count), cumulative_words = VALUES(cumulative_words),
					calc_version = VALUES(calc_version), source_hash = VALUES(source_hash)`,
				[
					note.perush_id,
					note.perek_id,
					note.pasuk,
					note.note_idx,
					wordCount,
					groupWords,
					READING_METRICS_CALC_VERSION,
					hash,
				],
			);
			notesWritten += 1;
			last = {
				perush: note.perush_id,
				perek: note.perek_id,
				pasuk: note.pasuk,
				note_idx: note.note_idx,
			};
		}
		if (notes.length < BATCH) break;
	}
	await flushGroup();

	// A commentary import can remove notes (or whole perush×perek groups);
	// the metric tables carry no FK on those coordinates, so orphaned rows
	// would survive forever. Prune every metric whose source note vanished
	// and every aggregate whose group vanished.
	const [prunedNotes] = await db.execute(
		`DELETE m FROM tanah_note_metric m
		 LEFT JOIN note n
		   ON n.perush_id = m.perush_id AND n.perek_id = m.perek_id
		  AND n.pasuk = m.pasuk AND n.note_idx = m.note_idx
		 WHERE n.perush_id IS NULL`,
		[],
	);
	const [prunedTotals] = await db.execute(
		`DELETE m FROM tanah_perush_metric m
		 LEFT JOIN (SELECT DISTINCT perush_id, perek_id FROM note) n
		   ON n.perush_id = m.perush_id AND n.perek_id = m.perek_id
		 WHERE n.perush_id IS NULL`,
		[],
	);
	const pruned =
		(prunedNotes as ResultSetHeader).affectedRows +
		(prunedTotals as ResultSetHeader).affectedRows;
	console.log(
		`perush: ${notesWritten} notes, ${totalsWritten} perush×perek totals written, ${totalsUnchanged} unchanged, ${pruned} stale rows pruned`,
	);
	// Only aggregate changes are user-visible: notes upsert unconditionally,
	// and a content change that keeps the group's hash identical leaves the
	// rendered estimate unchanged too.
	return totalsWritten + pruned;
}

// ---------------------------------------------------------------------------
// Website cache invalidation
// ---------------------------------------------------------------------------

/**
 * The website caches DB-backed content indefinitely (`unstable_cache` with
 * `revalidate: false`), so metric rows landing after a deploy leave badges
 * missing until the caches that render them expire. After writes, POST the
 * same `/api/revalidate` contract the admin uses
 * (src/server/website-revalidate.ts): `tag`/`path`/`type` params plus the
 * `x-revalidate-secret` header, configured by VITE_WEBSITE_URL +
 * REVALIDATE_SECRET. Unset means no website to invalidate (local runs).
 */
const KIND_INVALIDATION: Record<
	string,
	{ tag?: string; path?: string; type?: "page" }[]
> = {
	perek: [{ tag: "reading-metrics" }],
	article: [{ tag: "articles" }],
	perush: [{ tag: "perushim" }],
	// Pedia entry pages are prerendered by path, not tagged cache.
	entry: [{ path: "/pedia/[slug]", type: "page" }],
};

async function revalidateWebsite(
	changedKinds: Set<string>,
): Promise<void> {
	const requests = [...changedKinds].flatMap(
		(kind) => KIND_INVALIDATION[kind] ?? [],
	);
	if (requests.length === 0) return;
	const base = process.env.VITE_WEBSITE_URL?.replace(/\/+$/, "");
	const secret = process.env.REVALIDATE_SECRET;
	if (!base || !secret) {
		console.warn(
			"website revalidation skipped: VITE_WEBSITE_URL/REVALIDATE_SECRET not configured —",
			"invalidate manually:",
			requests,
		);
		return;
	}
	for (const request of requests) {
		const query = new URLSearchParams();
		if (request.tag) query.set("tag", request.tag);
		if (request.path) query.set("path", request.path);
		if (request.type) query.set("type", request.type);
		try {
			const response = await fetch(`${base}/api/revalidate?${query}`, {
				method: "POST",
				headers: { "x-revalidate-secret": secret },
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				console.warn(
					`website revalidation failed: HTTP ${response.status}`,
					request,
				);
			}
		} catch (error) {
			console.warn("website revalidation request failed", request, error);
		}
	}
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const changed = new Set<string>();
	if (kinds.has("perek") && (await backfillPerakim()) > 0) {
		changed.add("perek");
	}
	if (kinds.has("article")) {
		const touched = await backfillHtmlContent({
			name: "article",
			table: "tanah_article",
			keyCol: "id",
			metricTable: "tanah_article_metric",
			metricKeyCol: "article_id",
			blocksTable: "tanah_article_metric_block",
			keyIsNumeric: true,
		});
		if (touched > 0) changed.add("article");
	}
	if (kinds.has("perush") && (await backfillPerushim()) > 0) {
		changed.add("perush");
	}
	if (kinds.has("entry")) {
		const touched = await backfillHtmlContent({
			name: "entry",
			table: "tanahpedia_entry",
			keyCol: "id",
			metricTable: "tanahpedia_entry_metric",
			metricKeyCol: "entry_id",
			blocksTable: "tanahpedia_entry_metric_block",
			keyIsNumeric: false,
		});
		if (touched > 0) changed.add("entry");
	}
	await revalidateWebsite(changed);
	await pool.end();
}

main().catch((err) => {
	console.error("backfill failed:", err);
	process.exitCode = 1;
});
