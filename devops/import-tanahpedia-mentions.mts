/**
 * Imports mention-decoration rows produced by the annotation pipeline
 * (data/annotations/, issue #2516) into `tanahpedia_mention_decoration`.
 *
 *   node devops/import-tanahpedia-mentions.mts \
 *     --decorations <file.json> [--env-file <module/.dev.env>] [--dry-run] \
 *     [--supersede-model <model_revision>]
 *
 * Idempotent upserts: dedupe_key = md5(source identity + model_revision) so
 * repeat imports update `auto` rows in place instead of duplicating. Rows
 * with a non-`auto` acceptance (manual / held / rejected) are never
 * overwritten — human triage outlives re-imports.
 *
 * `--supersede-model` is the deliberate model-upgrade path: after the
 * upserts it deletes the superseded revision's pipeline-emitted rows
 * (`auto` + `held`) within the import file's source domains. Dedupe keys
 * include model_revision, so without it an upgraded pipeline would leave
 * the old revision's `auto` rows rendering alongside the new ones at the
 * same spans. `manual`/`rejected` rows are preserved — human decisions
 * survive a model swap. Rollback: re-import the old rows file.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { websiteMysql } from "./website-mysql.mts";

function parseFlags(argv: string[]) {
	const flags = new Map<string, string>();
	for (let i = 0; i < argv.length; i++) {
		const raw = argv[i];
		if (!raw.startsWith("--")) throw new Error(`unexpected argument "${raw}"`);
		const [name, inline] = raw.slice(2).split("=", 2);
		flags.set(name, inline ?? argv[++i] ?? "true");
	}
	return flags;
}

function loadDbUrl(envFile: string): string {
	if (process.env.DB_URL) return process.env.DB_URL;
	if (existsSync(envFile)) {
		for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
			const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
			if (!m || process.env[m[1]] !== undefined) continue;
			process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
		}
	}
	if (!process.env.DB_URL)
		throw new Error("DB_URL not set and no env file provided");
	return process.env.DB_URL;
}

function parseDbUrl(url: string) {
	const u = new URL(url.replace(/^mysql:\/\//, "http://"));
	return {
		host: u.hostname || "localhost",
		port: Number.parseInt(u.port || "3306", 10),
		user: u.username || "root",
		password: u.password || "",
		database: u.pathname?.slice(1)?.split("?")[0] || "tanah-dev",
	};
}

interface DecorationRow {
	source_kind: "pasuk" | "article";
	perek_id?: number | null;
	pasuk_number?: number | null;
	segment_start?: number | null;
	segment_end?: number | null;
	article_id?: number | null;
	content_hash?: string | null;
	span_start?: number | null;
	span_end?: number | null;
	surface: string;
	intended_name: string;
	entity_type: string;
	disambiguation?: string | null;
	confidence?: number | null;
	acceptance?: "auto" | "manual" | "held" | "rejected";
	model_revision: string;
	source_hash: string;
}

function sourceIdentity(row: DecorationRow): string {
	return row.source_kind === "pasuk"
		? `pasuk:${row.perek_id}:${row.pasuk_number}:${row.segment_start ?? ""}:${row.segment_end ?? ""}`
		: `article:${row.article_id}:${row.content_hash}:${row.span_start}:${row.span_end}`;
}

export function dedupeKey(row: DecorationRow): string {
	return createHash("md5")
		.update(`${sourceIdentity(row)}|${row.model_revision}`)
		.digest("hex");
}

/** uuid5-style deterministic id so re-imports keep stable row identity. */
export function rowId(key: string): string {
	const h = createHash("md5").update(`mention-decoration:${key}`).digest("hex");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const SOURCE_FIELDS = [
	"source_kind",
	"perek_id",
	"pasuk_number",
	"segment_start",
	"segment_end",
	"article_id",
	"content_hash",
	"span_start",
	"span_end",
] as const;

/**
 * DELETE that removes a superseded model revision's pipeline-emitted rows
 * (`auto` + `held`) within the import file's source domains — `manual` and
 * `rejected` rows always survive a model swap. Empty files get no scope.
 */
export function supersedeStatement(
	modelRevision: string,
	rows: DecorationRow[],
): { sql: string; countSql: string; params: string[] } {
	if (rows.some((r) => r.model_revision === modelRevision)) {
		throw new Error(
			`--supersede-model ${modelRevision} matches the file's own revision — supersede only a prior revision`,
		);
	}
	const kinds = [...new Set(rows.map((r) => r.source_kind))];
	const where = `model_revision = ? AND acceptance IN ('auto','held') AND source_kind IN (${kinds.map(() => "?").join(", ")})`;
	return {
		sql: `DELETE FROM tanahpedia_mention_decoration WHERE ${where}`,
		countSql: `SELECT COUNT(*) AS n FROM tanahpedia_mention_decoration WHERE ${where}`,
		params: [modelRevision, ...kinds],
	};
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));
	const decorationsFile = flags.get("decorations");
	if (!decorationsFile) throw new Error("--decorations <file> is required");
	const dryRun = flags.has("dry-run");
	const supersedeModel = flags.get("supersede-model");
	const envFile = flags.get("env-file") ?? ".dev.env";
	const mysql = websiteMysql();
	const rows = JSON.parse(
		readFileSync(decorationsFile, "utf8"),
	) as DecorationRow[];
	// Validate the supersede scope before connecting so a bad flag fails
	// without touching the database.
	const supersede =
		supersedeModel && rows.length > 0
			? supersedeStatement(supersedeModel, rows)
			: null;
	const conn = await mysql.createConnection(parseDbUrl(loadDbUrl(envFile)));
	let inserted = 0;
	let updated = 0;
	let preserved = 0;
	let superseded = 0;
	try {
		for (const row of rows) {
			const key = dedupeKey(row);
			const [existing] = await conn.execute(
				"SELECT id, acceptance FROM tanahpedia_mention_decoration WHERE dedupe_key = ?",
				[key],
			);
			const found = (existing as { id: string; acceptance: string }[])[0];
			if (found && found.acceptance !== "auto") {
				preserved++;
				continue;
			}
			if (dryRun) {
				found ? updated++ : inserted++;
				continue;
			}
			if (found) {
				await conn.execute(
					`UPDATE tanahpedia_mention_decoration SET
						surface = ?, intended_name = ?, entity_type = ?, disambiguation = ?,
						confidence = ?, source_hash = ?, ${SOURCE_FIELDS.map((f) => `\`${f}\` = ?`).join(", ")}
					WHERE dedupe_key = ?`,
					[
						row.surface,
						row.intended_name,
						row.entity_type,
						row.disambiguation ?? null,
						row.confidence ?? null,
						row.source_hash,
						...SOURCE_FIELDS.map((f) => row[f] ?? null),
						key,
					],
				);
				updated++;
			} else {
				await conn.execute(
					`INSERT INTO tanahpedia_mention_decoration
						(id, dedupe_key, ${SOURCE_FIELDS.map((f) => `\`${f}\``).join(", ")},
						 surface, intended_name, entity_type, disambiguation, confidence,
						 acceptance, model_revision, source_hash)
					VALUES (?, ?, ${SOURCE_FIELDS.map(() => "?").join(", ")}, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						rowId(key),
						key,
						...SOURCE_FIELDS.map((f) => row[f] ?? null),
						row.surface,
						row.intended_name,
						row.entity_type,
						row.disambiguation ?? null,
						row.confidence ?? null,
						row.acceptance ?? "auto",
						row.model_revision,
						row.source_hash,
					],
				);
				inserted++;
			}
		}
		// Supersede runs after the upserts so a failed import leaves the old
		// revision live — the swap stays recoverable.
		if (supersede) {
			if (dryRun) {
				const [countRows] = await conn.execute(
					supersede.countSql,
					supersede.params,
				);
				superseded = Number((countRows as { n: number }[])[0]?.n ?? 0);
			} else {
				const [result] = await conn.execute(supersede.sql, supersede.params);
				superseded = (result as { affectedRows?: number }).affectedRows ?? 0;
			}
		}
	} finally {
		await conn.end();
	}
	console.log(
		JSON.stringify({
			inserted,
			updated,
			preserved,
			superseded,
			total: rows.length,
			dryRun,
		}),
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await main();
}
