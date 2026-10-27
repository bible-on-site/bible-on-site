import { createServerFn } from "@tanstack/react-start";
import type { PoolConnection } from "mysql2/promise";
import { query, queryOne, transaction, txExecute } from "./db";
import { dedicationChange, revalidateWebsite } from "./website-revalidate";

/**
 * הקדשות CRUD (#2731). The expanded schema carries one row per dedication
 * (subject + optional UTC expiry), purpose links through
 * tanah_dedication_dedication_type, and one link table per target kind:
 * perek ranges, sefer, helek, weekly parasha, article, Tanahpedia entry,
 * and the whole מסורה על הפרק feature. Each link row can carry its own
 * assignment-level expiry.
 *
 * Expiry convention: `expires_at` is a UTC wall-clock (the same contract
 * the API and website apply); the UI enters "YYYY-MM-DD HH:mm" UTC and
 * values are stored verbatim as DATETIME — CAST on read keeps mysql2 from
 * re-interpreting them in local time.
 *
 * Every mutation enqueues a `dedication` entity change after commit so the
 * website expires the scoped cache entries and pages that render the
 * dedication; on delete the assignments are captured pre-commit (they are
 * unresolvable once the row cascades away).
 */

export type DedicationTargetKind = "perek" | "sefer" | "helek" | "parasha" | "article" | "entry" | "masora";

export interface DedicationTargetInput {
	kind: DedicationTargetKind;
	perekIdLow?: number;
	perekIdHigh?: number;
	seferId?: number;
	helekId?: number;
	parashaId?: number;
	articleId?: number;
	/** Canonical tanahpedia_entry.id (not the mutable unique_name). */
	entryId?: string;
	/** Assignment expiry, "YYYY-MM-DD HH:mm:ss" UTC; null/omitted = ongoing. */
	expiresAt?: string | null;
}

export interface DedicationUpsert {
	subject: string;
	/** tanah_dedication_type ids making up the purpose list. */
	purposeTypeIds: number[];
	/** Whole-dedication expiry, "YYYY-MM-DD HH:mm:ss" UTC; null = ongoing. */
	expiresAt?: string | null;
	targets: DedicationTargetInput[];
}

export interface AdminTarget {
	kind: DedicationTargetKind;
	label: string;
	/** Raw target fields — the edit form needs ids, not parsed labels. */
	perekIdLow?: number;
	perekIdHigh?: number;
	seferId?: number;
	helekId?: number;
	parashaId?: number;
	articleId?: number;
	entryId?: string;
	/** Assignment expiry, "YYYY-MM-DD HH:mm:ss" UTC; null = ongoing. */
	expiresAt: string | null;
}

export interface AdminDedication {
	id: number;
	subject: string;
	expiresAt: string | null;
	/** True when expires_at <= now (UTC) — still listed, admin sees expired rows. */
	expired: boolean;
	purposes: string[];
	targets: AdminTarget[];
}

export interface DedicationTargetOptions {
	sefarim: { id: number; name: string }[];
	heleks: { id: number; name: string }[];
	/** Weekly-parasha division size — a closed list shared with the website (54 units). */
	parashaCount: number;
}

/** Closed weekly-parasha division — keep in sync with the website's getParashaUnitCount(). */
const PARASHA_UNIT_COUNT = 54;

export const getDedicationTypes = createServerFn({ method: "GET" }).handler(
	async (): Promise<{ id: number; description: string }[]> =>
		query<{ id: number; description: string }>("SELECT id, description FROM tanah_dedication_type ORDER BY id"),
);

export const getDedicationTargetOptions = createServerFn({ method: "GET" }).handler(
	async (): Promise<DedicationTargetOptions> => {
		const [sefarim, heleks] = await Promise.all([
			query<{ id: number; name: string }>("SELECT id, name FROM tanah_sefer ORDER BY id"),
			query<{ id: number; name: string }>("SELECT id, name FROM tanah_helek ORDER BY id"),
		]);
		return { sefarim, heleks, parashaCount: PARASHA_UNIT_COUNT };
	},
);

interface LinkRows {
	perek: { perek_id_low: number; perek_id_high: number; expires_at: string | null }[];
	sefer: { sefer_id: number; expires_at: string | null }[];
	helek: { helek_id: number; expires_at: string | null }[];
	parasha: { parasha_id: number; expires_at: string | null }[];
	article: { article_id: number; name: string | null; expires_at: string | null }[];
	entry: { entry_id: string; unique_name: string | null; expires_at: string | null }[];
	masora: { expires_at: string | null }[];
}

async function loadTargets(ids: number[]): Promise<Map<number, AdminTarget[]>> {
	if (ids.length === 0) return new Map();
	const ph = ids.map(() => "?").join(", ");
	const [perek, sefer, helek, parasha, article, entry, masora] = await Promise.all([
		query<LinkRows["perek"][number]>(
			`SELECT dedication_id, perek_id_low, perek_id_high, CAST(expires_at AS CHAR) AS expires_at FROM tanah_perek_dedication WHERE dedication_id IN (${ph})`,
			ids,
		) as Promise<(LinkRows["perek"][number] & { dedication_id: number })[]>,
		query<(LinkRows["sefer"][number] & { dedication_id: number })>(
			`SELECT dedication_id, sefer_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_sefer_dedication WHERE dedication_id IN (${ph})`,
			ids,
		),
		query<(LinkRows["helek"][number] & { dedication_id: number })>(
			`SELECT dedication_id, helek_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_helek_dedication WHERE dedication_id IN (${ph})`,
			ids,
		),
		query<(LinkRows["parasha"][number] & { dedication_id: number })>(
			`SELECT dedication_id, parasha_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_parasha_dedication WHERE dedication_id IN (${ph})`,
			ids,
		),
		query<(LinkRows["article"][number] & { dedication_id: number })>(
			`SELECT ad.dedication_id, ad.article_id, a.name, CAST(ad.expires_at AS CHAR) AS expires_at
			 FROM tanah_article_dedication ad LEFT JOIN tanah_article a ON a.id = ad.article_id
			 WHERE ad.dedication_id IN (${ph})`,
			ids,
		),
		query<(LinkRows["entry"][number] & { dedication_id: number })>(
			`SELECT ed.dedication_id, ed.entry_id, e.unique_name, CAST(ed.expires_at AS CHAR) AS expires_at
			 FROM tanahpedia_entry_dedication ed LEFT JOIN tanahpedia_entry e ON e.id = ed.entry_id
			 WHERE ed.dedication_id IN (${ph})`,
			ids,
		),
		query<(LinkRows["masora"][number] & { dedication_id: number })>(
			`SELECT dedication_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_masora_dedication WHERE dedication_id IN (${ph})`,
			ids,
		),
	]);
	const seferNames = new Map(
		(
			await query<{ id: number; name: string }>("SELECT id, name FROM tanah_sefer")
		).map((s) => [s.id, s.name]),
	);
	const helekNames = new Map(
		(
			await query<{ id: number; name: string }>("SELECT id, name FROM tanah_helek")
		).map((h) => [h.id, h.name]),
	);
	const out = new Map<number, AdminTarget[]>();
	const push = (id: number, target: AdminTarget) => {
		const list = out.get(id) ?? [];
		list.push(target);
		out.set(id, list);
	};
	for (const row of perek) {
		push(row.dedication_id, {
			kind: "perek",
			label: `פרקים ${row.perek_id_low}-${row.perek_id_high}`,
			perekIdLow: row.perek_id_low,
			perekIdHigh: row.perek_id_high,
			expiresAt: row.expires_at,
		});
	}
	for (const row of sefer) {
		push(row.dedication_id, {
			kind: "sefer",
			label: `ספר ${seferNames.get(row.sefer_id) ?? row.sefer_id}`,
			seferId: row.sefer_id,
			expiresAt: row.expires_at,
		});
	}
	for (const row of helek) {
		push(row.dedication_id, {
			kind: "helek",
			label: `חלק ${helekNames.get(row.helek_id) ?? row.helek_id}`,
			helekId: row.helek_id,
			expiresAt: row.expires_at,
		});
	}
	for (const row of parasha) {
		push(row.dedication_id, {
			kind: "parasha",
			label: `פרשה שבועית #${row.parasha_id}`,
			parashaId: row.parasha_id,
			expiresAt: row.expires_at,
		});
	}
	for (const row of article) {
		push(row.dedication_id, {
			kind: "article",
			label: `מאמר ${row.name ?? row.article_id}`,
			articleId: row.article_id,
			expiresAt: row.expires_at,
		});
	}
	for (const row of entry) {
		push(row.dedication_id, {
			kind: "entry",
			label: `ערך תנכפדיה ${row.unique_name ?? row.entry_id}`,
			entryId: row.entry_id,
			expiresAt: row.expires_at,
		});
	}
	for (const row of masora) {
		push(row.dedication_id, {
			kind: "masora",
			label: "מסורה על הפרק (כל היחידות)",
			expiresAt: row.expires_at,
		});
	}
	return out;
}

/** The `{changes}` payload members for one dedication's assignment set. */
function changeFromTargets(targets: AdminTarget[] | DedicationTargetInput[]) {
	const raw = targets as (DedicationTargetInput & { label?: string })[];
	return {
		perekRanges: raw
			.filter((t) => t.kind === "perek")
			.map((t) => ({ low: t.perekIdLow ?? 0, high: t.perekIdHigh ?? 0 })),
		seferIds: raw.filter((t) => t.kind === "sefer").map((t) => t.seferId ?? 0),
		helekIds: raw.filter((t) => t.kind === "helek").map((t) => t.helekId ?? 0),
		parashaIds: raw.filter((t) => t.kind === "parasha").map((t) => t.parashaId ?? 0),
		articleIds: raw.filter((t) => t.kind === "article").map((t) => t.articleId ?? 0),
		entryIds: raw.filter((t) => t.kind === "entry").map((t) => t.entryId ?? ""),
		masora: raw.some((t) => t.kind === "masora"),
	};
}

async function enrich(rows: { id: number; subject: string; expires_at: string | null; expired: number }[]): Promise<AdminDedication[]> {
	const ids = rows.map((r) => r.id);
	const ph = ids.map(() => "?").join(", ");
	const [purposeLinks, types, targets] = await Promise.all([
		ids.length
			? query<{ dedication_id: number; dedication_type_id: number }>(
					`SELECT dedication_id, dedication_type_id FROM tanah_dedication_dedication_type WHERE dedication_id IN (${ph})`,
					ids,
				)
			: Promise.resolve([]),
		query<{ id: number; description: string }>("SELECT id, description FROM tanah_dedication_type"),
		loadTargets(ids),
	]);
	const typeNames = new Map(types.map((t) => [t.id, t.description]));
	const purposesById = new Map<number, string[]>();
	for (const link of purposeLinks) {
		const name = typeNames.get(link.dedication_type_id);
		if (!name) continue;
		purposesById.set(link.dedication_id, [...(purposesById.get(link.dedication_id) ?? []), name].sort());
	}
	return rows.map((row) => ({
		id: row.id,
		subject: row.subject,
		expiresAt: row.expires_at,
		expired: row.expired === 1,
		purposes: purposesById.get(row.id) ?? [],
		targets: targets.get(row.id) ?? [],
	}));
}

export interface ListFilter {
	search?: string;
	/** "active" (default) | "expired" | "all" — expired rows stay manageable (#2731). */
	show?: "active" | "expired" | "all";
}

export const listDedications = createServerFn({ method: "GET" })
	.validator((data?: ListFilter) => data ?? {})
	.handler(async ({ data }): Promise<AdminDedication[]> => {
		const clauses: string[] = [];
		const params: unknown[] = [];
		if (data.search?.trim()) {
			clauses.push("d.subject LIKE ?");
			params.push(`%${data.search.trim()}%`);
		}
		if (data.show === "active") clauses.push("(d.expires_at IS NULL OR d.expires_at > UTC_TIMESTAMP())");
		if (data.show === "expired") clauses.push("(d.expires_at IS NOT NULL AND d.expires_at <= UTC_TIMESTAMP())");
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = await query<{ id: number; subject: string; expires_at: string | null; expired: number }>(
			`SELECT d.id, d.subject, CAST(d.expires_at AS CHAR) AS expires_at,
			        (d.expires_at IS NOT NULL AND d.expires_at <= UTC_TIMESTAMP()) AS expired
			 FROM tanah_dedication d ${where} ORDER BY d.id`,
			params,
		);
		return enrich(rows);
	});

export const getDedication = createServerFn({ method: "GET" })
	.validator((id: number) => id)
	.handler(async ({ data: id }): Promise<AdminDedication | null> => {
		const rows = await query<{ id: number; subject: string; expires_at: string | null; expired: number }>(
			`SELECT id, subject, CAST(expires_at AS CHAR) AS expires_at,
			        (expires_at IS NOT NULL AND expires_at <= UTC_TIMESTAMP()) AS expired
			 FROM tanah_dedication WHERE id = ?`,
			[id],
		);
		if (!rows.length) return null;
		return (await enrich(rows))[0];
	});

const EXPIRY_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;

/** Normalize "YYYY-MM-DD HH:mm[:ss]" (UTC wall-clock) for DATETIME storage. */
export function normalizeExpiry(value?: string | null): string | null {
	if (value == null || value.trim() === "") return null;
	const trimmed = value.trim().replace("T", " ");
	if (!EXPIRY_PATTERN.test(trimmed)) throw new Error("תוקף חייב להיות בפורמט YYYY-MM-DD HH:mm (UTC)");
	const normalized = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
	if (Number.isNaN(new Date(`${normalized.replace(" ", "T")}Z`).getTime())) {
		throw new Error("תוקף אינו תאריך חוקי");
	}
	return normalized;
}

function validateTarget(target: DedicationTargetInput): void {
	const int = (v: unknown) => typeof v === "number" && Number.isInteger(v);
	switch (target.kind) {
		case "perek":
			if (!int(target.perekIdLow) || !int(target.perekIdHigh) || (target.perekIdLow ?? 0) < 1 || (target.perekIdHigh ?? 0) < (target.perekIdLow ?? 0)) {
				throw new Error("טווח פרקים אינו חוקי");
			}
			break;
		case "sefer":
			if (!int(target.seferId)) throw new Error("יש לבחור ספר");
			break;
		case "helek":
			if (!int(target.helekId)) throw new Error("יש לבחור חלק");
			break;
		case "parasha":
			if (!int(target.parashaId) || (target.parashaId ?? 0) < 1 || (target.parashaId ?? 0) > PARASHA_UNIT_COUNT) {
				throw new Error(`פרשה שבועית חייבת להיות מספר 1-${PARASHA_UNIT_COUNT}`);
			}
			break;
		case "article":
			if (!int(target.articleId)) throw new Error("מזהה מאמר אינו חוקי");
			break;
		case "entry":
			if (!target.entryId?.trim()) throw new Error("יש להזין מזהה ערך תנכפדיה");
			break;
		case "masora":
			break;
		default:
			throw new Error("סוג יעד לא מוכר");
	}
	normalizeExpiry(target.expiresAt);
}

async function validateReferenceTargets(targets: DedicationTargetInput[]): Promise<void> {
	const seferIds = targets.filter((t) => t.kind === "sefer").map((t) => t.seferId ?? 0);
	for (const id of seferIds) {
		if (!(await queryOne("SELECT id FROM tanah_sefer WHERE id = ?", [id]))) throw new Error(`ספר ${id} לא קיים`);
	}
	const helekIds = targets.filter((t) => t.kind === "helek").map((t) => t.helekId ?? 0);
	for (const id of helekIds) {
		if (!(await queryOne("SELECT id FROM tanah_helek WHERE id = ?", [id]))) throw new Error(`חלק ${id} לא קיים`);
	}
	for (const t of targets.filter((t) => t.kind === "perek")) {
		if (!(await queryOne("SELECT id FROM tanah_perek WHERE id = ?", [t.perekIdLow]))) throw new Error(`פרק ${t.perekIdLow} לא קיים`);
		if (!(await queryOne("SELECT id FROM tanah_perek WHERE id = ?", [t.perekIdHigh]))) throw new Error(`פרק ${t.perekIdHigh} לא קיים`);
	}
	for (const t of targets.filter((t) => t.kind === "article")) {
		if (!(await queryOne("SELECT id FROM tanah_article WHERE id = ?", [t.articleId]))) throw new Error(`מאמר ${t.articleId} לא קיים`);
	}
	for (const t of targets.filter((t) => t.kind === "entry")) {
		if (!(await queryOne("SELECT id FROM tanahpedia_entry WHERE id = ?", [t.entryId?.trim()]))) {
			throw new Error(`ערך תנכפדיה ${t.entryId} לא קיים`);
		}
	}
}

function validateUpsert(input: DedicationUpsert): { subject: string; expiresAt: string | null; targets: DedicationTargetInput[] } {
	const subject = input.subject?.trim();
	if (!subject) throw new Error("יש להזין את שם המוקדש");
	if (!Array.isArray(input.purposeTypeIds) || input.purposeTypeIds.some((t) => !Number.isInteger(t))) {
		throw new Error("מטרות ההקדשה אינן חוקיות");
	}
	if (!input.targets?.length) throw new Error("יש להוסיף לפחות יעד אחד");
	for (const target of input.targets) validateTarget(target);
	return {
		subject,
		expiresAt: normalizeExpiry(input.expiresAt),
		targets: input.targets.map((t) => ({ ...t, expiresAt: normalizeExpiry(t.expiresAt) })),
	};
}

async function deleteTargetRows(connection: PoolConnection, id: number): Promise<void> {
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
		await txExecute(connection, `DELETE FROM ${table} WHERE dedication_id = ?`, [id]);
	}
}

export const createDedication = createServerFn({ method: "POST" })
	.validator((data: DedicationUpsert) => ({ ...data, ...validateUpsert(data) }))
	.handler(async ({ data }): Promise<AdminDedication> => {
		await validateReferenceTargets(data.targets);
		const id = await transaction(async (connection) => {
			const result = await txExecute(
				connection,
				"INSERT INTO tanah_dedication (subject, expires_at) VALUES (?, ?)",
				[data.subject, data.expiresAt],
			);
			const insertId = result.insertId;
			for (const typeId of data.purposeTypeIds) {
				await txExecute(
					connection,
					"INSERT INTO tanah_dedication_dedication_type (dedication_id, dedication_type_id) VALUES (?, ?)",
					[insertId, typeId],
				);
			}
			for (const t of data.targets) {
				await insertTarget(connection, insertId, t);
			}
			return insertId;
		});
		// Post-commit: expire every scoped page that now renders it (#2731).
		void revalidateWebsite([dedicationChange({ id, ...changeFromTargets(data.targets) })]);
		return {
			id,
			subject: data.subject,
			expiresAt: data.expiresAt,
			expired: false,
			purposes: [],
			targets: data.targets.map((t) => ({ kind: t.kind, label: targetLabel(t), expiresAt: t.expiresAt ?? null })),
		};
	});

async function insertTarget(connection: PoolConnection, dedicationId: number, t: DedicationTargetInput): Promise<void> {
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

function targetLabel(t: DedicationTargetInput): string {
	switch (t.kind) {
		case "perek": return `פרקים ${t.perekIdLow}-${t.perekIdHigh}`;
		case "sefer": return `ספר ${t.seferId}`;
		case "helek": return `חלק ${t.helekId}`;
		case "parasha": return `פרשה שבועית #${t.parashaId}`;
		case "article": return `מאמר ${t.articleId}`;
		case "entry": return `ערך תנכפדיה ${t.entryId}`;
		case "masora": return "מסורה על הפרק (כל היחידות)";
	}
}

/** The raw assignment set of a dedication, pre-commit readable (delete path). */
async function currentTargets(id: number): Promise<DedicationTargetInput[]> {
	const [perek, sefer, helek, parasha, article, entry, masora] = await Promise.all([
		query<{ perek_id_low: number; perek_id_high: number; expires_at: string | null }>(
			"SELECT perek_id_low, perek_id_high, CAST(expires_at AS CHAR) AS expires_at FROM tanah_perek_dedication WHERE dedication_id = ?",
			[id],
		),
		query<{ sefer_id: number; expires_at: string | null }>(
			"SELECT sefer_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_sefer_dedication WHERE dedication_id = ?",
			[id],
		),
		query<{ helek_id: number; expires_at: string | null }>(
			"SELECT helek_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_helek_dedication WHERE dedication_id = ?",
			[id],
		),
		query<{ parasha_id: number; expires_at: string | null }>(
			"SELECT parasha_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_parasha_dedication WHERE dedication_id = ?",
			[id],
		),
		query<{ article_id: number; expires_at: string | null }>(
			"SELECT article_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_article_dedication WHERE dedication_id = ?",
			[id],
		),
		query<{ entry_id: string; expires_at: string | null }>(
			"SELECT entry_id, CAST(expires_at AS CHAR) AS expires_at FROM tanahpedia_entry_dedication WHERE dedication_id = ?",
			[id],
		),
		query<{ expires_at: string | null }>(
			"SELECT CAST(expires_at AS CHAR) AS expires_at FROM tanah_masora_dedication WHERE dedication_id = ?",
			[id],
		),
	]);
	return [
		...perek.map((r) => ({ kind: "perek" as const, perekIdLow: r.perek_id_low, perekIdHigh: r.perek_id_high, expiresAt: r.expires_at })),
		...sefer.map((r) => ({ kind: "sefer" as const, seferId: r.sefer_id, expiresAt: r.expires_at })),
		...helek.map((r) => ({ kind: "helek" as const, helekId: r.helek_id, expiresAt: r.expires_at })),
		...parasha.map((r) => ({ kind: "parasha" as const, parashaId: r.parasha_id, expiresAt: r.expires_at })),
		...article.map((r) => ({ kind: "article" as const, articleId: r.article_id, expiresAt: r.expires_at })),
		...entry.map((r) => ({ kind: "entry" as const, entryId: r.entry_id, expiresAt: r.expires_at })),
		...masora.map((r) => ({ kind: "masora" as const, expiresAt: r.expires_at })),
	];
}

/** Merge old ∪ new assignment sets — the invalidation covers both sides. */
function mergeChanges(id: number, oldTargets: DedicationTargetInput[], newTargets: DedicationTargetInput[]) {
	const oldChange = changeFromTargets(oldTargets);
	const newChange = changeFromTargets(newTargets);
	return {
		id,
		perekRanges: [...oldChange.perekRanges, ...newChange.perekRanges],
		seferIds: [...new Set([...oldChange.seferIds, ...newChange.seferIds])],
		helekIds: [...new Set([...oldChange.helekIds, ...newChange.helekIds])],
		parashaIds: [...new Set([...oldChange.parashaIds, ...newChange.parashaIds])],
		articleIds: [...new Set([...oldChange.articleIds, ...newChange.articleIds])],
		entryIds: [...new Set([...oldChange.entryIds, ...newChange.entryIds])],
		masora: oldChange.masora || newChange.masora,
	};
}

export const updateDedication = createServerFn({ method: "POST" })
	.validator((data: { id: number } & DedicationUpsert) => ({ ...data, ...validateUpsert(data) }))
	.handler(async ({ data }): Promise<{ id: number }> => {
		if (!(await queryOne("SELECT id FROM tanah_dedication WHERE id = ?", [data.id]))) {
			throw new Error("ההקדשה לא נמצאה");
		}
		await validateReferenceTargets(data.targets);
		const oldTargets = await currentTargets(data.id);
		await transaction(async (connection) => {
			await txExecute(connection, "UPDATE tanah_dedication SET subject = ?, expires_at = ? WHERE id = ?", [
				data.subject,
				data.expiresAt,
				data.id,
			]);
			await deleteTargetRows(connection, data.id);
			for (const typeId of data.purposeTypeIds) {
				await txExecute(
					connection,
					"INSERT INTO tanah_dedication_dedication_type (dedication_id, dedication_type_id) VALUES (?, ?)",
					[data.id, typeId],
				);
			}
			for (const t of data.targets) {
				await insertTarget(connection, data.id, t);
			}
		});
		void revalidateWebsite([dedicationChange(mergeChanges(data.id, oldTargets, data.targets))]);
		return { id: data.id };
	});

export const deleteDedication = createServerFn({ method: "POST" })
	.validator((id: number) => id)
	.handler(async ({ data: id }): Promise<{ id: number }> => {
		// Capture the assignment set pre-commit — it cascades away with the row.
		const oldTargets = await currentTargets(id);
		await transaction(async (connection) => {
			await txExecute(connection, "DELETE FROM tanah_dedication WHERE id = ?", [id]);
		});
		void revalidateWebsite([dedicationChange({ id, ...changeFromTargets(oldTargets) })]);
		return { id };
	});

/** The public line the website renders — mirrors formatDedication (#2731). */
export function previewDedicationLine(subject: string, purposes: string[]): string {
	const clean = purposes.filter((p) => p.trim().length > 0);
	return clean.length === 0 ? `מוקדש ל${subject}` : `מוקדש ל${subject} (${clean.join(", ")})`;
}
