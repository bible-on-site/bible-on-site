import type { PoolConnection } from "mysql2/promise";
import { query, queryOne, transaction, txExecute } from "./db";
import {
	currentTargets,
	mergeChanges,
	syncDedicationExpiry,
} from "./dedication-expiry";
import type { DedicationTargetInput } from "./dedications";
import { dedicationChange, revalidateWebsite } from "./website-revalidate";

/**
 * Server-only transactional helpers for the dedication target tables —
 * expiry normalization, link-row insert/delete, the cross-table
 * referential check, and the link-proposal aggregate write path (#3103).
 * Shared by the CRUD server-fns in ./dedications.
 *
 * Lives in a `.server` module (never imported by client code): plain
 * functions exported from a `createServerFn` module stay live in the
 * client bundle and would drag `../db`/`mysql2` into it — the same hazard
 * documented in ./dedication-expiry and ./tanahpedia/alias-ops.server.
 */

const EXPIRY_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;

/** Normalize "YYYY-MM-DD HH:mm[:ss]" (UTC wall-clock) for DATETIME storage. */
export function normalizeExpiry(value?: string | null): string | null {
	if (value == null || value.trim() === "") return null;
	const trimmed = value.trim().replace("T", " ");
	if (!EXPIRY_PATTERN.test(trimmed))
		throw new Error("תוקף חייב להיות בפורמט YYYY-MM-DD HH:mm (UTC)");
	const normalized = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
	const instant = new Date(`${normalized.replace(" ", "T")}Z`);
	// Date normalizes values such as February 30 and 24:00. Reject those
	// rollovers so the stored DATETIME matches the UTC instant entered.
	if (
		Number.isNaN(instant.getTime()) ||
		instant.toISOString().slice(0, 19).replace("T", " ") !== normalized
	) {
		throw new Error("תוקף אינו תאריך חוקי");
	}
	return normalized;
}

/**
 * Batched existence check: one query per referenced table via the same
 * JSON_TABLE `IN` expansion as ./dedications (keeps each statement a pure
 * literal, so no id set taints the SQL text). The validation loop then
 * diffs the returned ids against the requested sequence to throw the same
 * per-target error a sequential check would.
 */
const IN_IDS =
	"IN (SELECT v FROM JSON_TABLE(?, '$[*]' COLUMNS (v INT PATH '$')) jt)";
const IN_TEXT_IDS =
	"IN (SELECT v FROM JSON_TABLE(?, '$[*]' COLUMNS (v CHAR(36) PATH '$')) jt)";

async function existingIds(table: string, ids: number[]): Promise<Set<number>> {
	if (!ids.length) return new Set();
	const rows = await query<{ id: number }>(
		`SELECT id FROM ${table} WHERE id ${IN_IDS}`,
		[JSON.stringify([...new Set(ids)])],
	);
	return new Set(rows.map((r) => r.id));
}

export async function validateReferenceTargets(
	targets: DedicationTargetInput[],
): Promise<void> {
	const seferIds = targets
		.filter((t) => t.kind === "sefer")
		.map((t) => t.seferId ?? 0);
	const helekIds = targets
		.filter((t) => t.kind === "helek")
		.map((t) => t.helekId ?? 0);
	const perekChecks = targets
		.filter((t) => t.kind === "perek")
		.flatMap((t) => [t.perekIdLow ?? 0, t.perekIdHigh ?? 0]);
	const articleIds = targets
		.filter((t) => t.kind === "article")
		.map((t) => t.articleId ?? 0);
	const entryTargets = targets.filter((t) => t.kind === "entry");
	const entryIds = entryTargets.map((t) => t.entryId?.trim() ?? "");
	const [seferFound, helekFound, perekFound, articleFound, entryFound] =
		await Promise.all([
			existingIds("tanah_sefer", seferIds),
			existingIds("tanah_helek", helekIds),
			existingIds("tanah_perek", perekChecks),
			existingIds("tanah_article", articleIds),
			entryIds.length
				? query<{ id: string }>(
						`SELECT id FROM tanahpedia_entry WHERE id ${IN_TEXT_IDS}`,
						[JSON.stringify([...new Set(entryIds)])],
					).then((rows) => new Set(rows.map((r) => r.id.toLowerCase())))
				: new Set<string>(),
		]);
	for (const id of seferIds) {
		if (!seferFound.has(id)) throw new Error(`ספר ${id} לא קיים`);
	}
	for (const id of helekIds) {
		if (!helekFound.has(id)) throw new Error(`חלק ${id} לא קיים`);
	}
	for (const t of targets.filter((t) => t.kind === "perek")) {
		if (!perekFound.has(t.perekIdLow ?? 0))
			throw new Error(`פרק ${t.perekIdLow} לא קיים`);
		if (!perekFound.has(t.perekIdHigh ?? 0))
			throw new Error(`פרק ${t.perekIdHigh} לא קיים`);
	}
	for (const t of targets.filter((t) => t.kind === "article")) {
		if (!articleFound.has(t.articleId ?? 0))
			throw new Error(`מאמר ${t.articleId} לא קיים`);
	}
	for (const t of entryTargets) {
		// tanahpedia_entry.id is *_ci: SQL matches case-insensitively, so
		// the returned-id diff must fold case the same way.
		if (!entryFound.has((t.entryId?.trim() ?? "").toLowerCase())) {
			throw new Error(`ערך תנכפדיה ${t.entryId} לא קיים`);
		}
	}
}

export async function deleteTargetRows(
	connection: PoolConnection,
	id: number,
): Promise<void> {
	for (const table of [
		"tanah_perek_dedication",
		"tanah_sefer_dedication",
		"tanah_helek_dedication",
		"tanah_parasha_dedication",
		"tanah_article_dedication",
		"tanahpedia_entry_dedication",
		"tanah_masora_dedication",
		"tanah_dedication_dedication_type",
	]) {
		await txExecute(
			connection,
			`DELETE FROM ${table} WHERE dedication_id = ?`,
			[id],
		);
	}
}

export async function insertTarget(
	connection: PoolConnection,
	dedicationId: number,
	t: DedicationTargetInput,
): Promise<void> {
	const expiry = t.expiresAt ?? null;
	switch (t.kind) {
		case "perek":
			await txExecute(
				connection,
				"INSERT INTO tanah_perek_dedication (perek_id_low, perek_id_high, dedication_id, expires_at) VALUES (?, ?, ?, ?)",
				[t.perekIdLow, t.perekIdHigh, dedicationId, expiry],
			);
			break;
		case "sefer":
			await txExecute(
				connection,
				"INSERT INTO tanah_sefer_dedication (sefer_id, dedication_id, expires_at) VALUES (?, ?, ?)",
				[t.seferId, dedicationId, expiry],
			);
			break;
		case "helek":
			await txExecute(
				connection,
				"INSERT INTO tanah_helek_dedication (helek_id, dedication_id, expires_at) VALUES (?, ?, ?)",
				[t.helekId, dedicationId, expiry],
			);
			break;
		case "parasha":
			await txExecute(
				connection,
				"INSERT INTO tanah_parasha_dedication (parasha_id, dedication_id, expires_at) VALUES (?, ?, ?)",
				[t.parashaId, dedicationId, expiry],
			);
			break;
		case "article":
			await txExecute(
				connection,
				"INSERT INTO tanah_article_dedication (article_id, dedication_id, expires_at) VALUES (?, ?, ?)",
				[t.articleId, dedicationId, expiry],
			);
			break;
		case "entry":
			await txExecute(
				connection,
				"INSERT INTO tanahpedia_entry_dedication (entry_id, dedication_id, expires_at) VALUES (?, ?, ?)",
				[t.entryId?.trim(), dedicationId, expiry],
			);
			break;
		case "masora":
			await txExecute(
				connection,
				"INSERT INTO tanah_masora_dedication (dedication_id, expires_at) VALUES (?, ?)",
				[dedicationId, expiry],
			);
			break;
	}
}

/**
 * Adds or removes one article target on an existing dedication — the
 * aggregate write path the link-proposal apply step calls (#3103): the
 * dedication owns its full target set, so this rewrites the target list
 * through the same validation, transaction and invalidation as
 * updateDedication rather than touching the link table directly.
 */
export async function applyArticleDedicationLink(params: {
	dedicationId: number;
	articleId: number;
	op: "add" | "remove";
	expiresAt?: string | null;
}): Promise<{ changed: boolean; reason?: string }> {
	const dedication = await queryOne<{ id: number }>(
		"SELECT id FROM tanah_dedication WHERE id = ?",
		[params.dedicationId],
	);
	if (!dedication) {
		return { changed: false, reason: "ההקדשה לא נמצאה" };
	}
	const targets = await currentTargets(params.dedicationId);
	const hasArticle = targets.some(
		(t) => t.kind === "article" && t.articleId === params.articleId,
	);
	const expiresAt = normalizeExpiry(params.expiresAt);
	let next: DedicationTargetInput[];
	if (params.op === "add") {
		if (hasArticle) {
			return { changed: false, reason: "המאמר כבר משויך להקדשה" };
		}
		next = [
			...targets,
			{ kind: "article", articleId: params.articleId, expiresAt },
		];
	} else {
		if (!hasArticle) {
			return { changed: false, reason: "המאמר אינו משויך להקדשה" };
		}
		next = targets.filter(
			(t) => !(t.kind === "article" && t.articleId === params.articleId),
		);
	}
	await validateReferenceTargets(next);
	await transaction(async (connection) => {
		await deleteTargetRows(connection, params.dedicationId);
		for (const target of next) {
			await insertTarget(connection, params.dedicationId, target);
		}
	});
	void revalidateWebsite([
		dedicationChange(mergeChanges(params.dedicationId, targets, next)),
	]);
	void syncDedicationExpiry(params.dedicationId);
	return { changed: true };
}
