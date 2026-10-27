/**
 * Dedication applicability resolver (#2731) — the website's read path.
 *
 * Mirrors `dedications_service::resolve` in the Rust API one-to-one so
 * website, admin preview and native app agree: every link table is
 * scanned (they are small by design), direct and ancestor scopes are
 * matched in code, dedication-level and assignment-level expiry both
 * gate inclusion, and results deduplicate by dedication id.
 *
 * Rollout: when the expanded dedication schema is not deployed yet the
 * resolver returns no dedications rather than failing the page — the
 * same degrade the covering-source reader applies
 * (ER_NO_SUCH_TABLE / ER_BAD_FIELD_ERROR only; other errors propagate).
 */
import { query } from "@/lib/api-client";
import { isMissingMysqlSchema } from "@/lib/mysql-errors";
import catalog from "@/data/db/client-catalog.generated.json";
import type {
	Dedication,
	DedicationContext,
	DedicationScope,
} from "./types";

/**
 * Canonical sefer metadata — the generated client catalog (canonical
 * tanah_sefer order: id = index + 1), so resolving ancestors never pulls
 * the 77 MB scripture dump into a route graph.
 */
const SEFARIM = catalog.books;

/** Canonical tanah_helek id by helek name (1 תורה, 2 נביאים, 3 כתובים). */
export const HELEK_IDS: Record<string, number> = {
	תורה: 1,
	נביאים: 2,
	כתובים: 3,
};

/** Canonical sefer ids (1-based index into `SEFARIM`) per helek id. */
export const HELEK_SEFER_IDS: Record<number, number[]> = Object.fromEntries(
	Object.entries(HELEK_IDS).map(([name, id]) => [
		id,
		SEFARIM.flatMap((sefer, index) =>
			sefer.helek === name ? [index + 1] : [],
		),
	]),
);

/** Canonical perek ids of one sefer (inclusive perekFrom..perekTo). */
export function seferPerekIds(seferId: number): number[] {
	const sefer = SEFARIM[seferId - 1];
	if (!sefer) return [];
	const ids: number[] = [];
	for (let id = sefer.perekFrom; id <= sefer.perekTo; id++) ids.push(id);
	return ids;
}

/** Canonical sefer name by tanah_sefer id. */
export const SEFER_NAME_BY_ID: Record<number, string> = Object.fromEntries(
	SEFARIM.map((sefer, index) => [index + 1, sefer.name]),
);

/** Canonical tanah_sefer id by sefer name (undefined for unknown names). */
export function seferIdByName(name: string): number | undefined {
	const index = SEFARIM.findIndex((sefer) => sefer.name === name);
	return index >= 0 ? index + 1 : undefined;
}

/** Canonical tanah_sefer id owning `perekId` (undefined outside 1..929). */
export function seferIdByPerekId(perekId: number): number | undefined {
	const index = SEFARIM.findIndex(
		(s) => s.perekFrom <= perekId && s.perekTo >= perekId,
	);
	return index >= 0 ? index + 1 : undefined;
}

/** Canonical tanah_helek id owning `seferId` (undefined for unknown ids). */
export function helekIdBySeferId(seferId: number): number | undefined {
	const sefer = SEFARIM[seferId - 1];
	return sefer ? HELEK_IDS[sefer.helek] : undefined;
}

/** Canonical helek name by tanah_helek id. */
export const HELEK_NAME_BY_ID: Record<number, string> = Object.fromEntries(
	Object.entries(HELEK_IDS).map(([name, id]) => [id, name]),
);

/**
 * `expires_at` is a UTC wall-clock (docs/data/dedications.md). Selecting it
 * as CHAR sidesteps mysql2's local-timezone Date parsing; "YYYY-MM-DD
 * HH:MM:SS" parses back as UTC. The exact expiry instant is already hidden.
 */
export function parseExpiryUtc(value: string | null): Date | null {
	if (value === null) return null;
	const parsed = new Date(`${value.replace(" ", "T")}Z`);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A dedication or assignment is active while its expiry is null/future. */
function isActive(expiresAt: string | null, now: Date): boolean {
	const expiry = parseExpiryUtc(expiresAt);
	return expiry === null || expiry.getTime() > now.getTime();
}

interface DedicationRow {
	id: number;
	subject: string;
	expires_at: string | null;
}

interface PurposeLinkRow {
	dedication_id: number;
	dedication_type_id: number;
}

interface TypeRow {
	id: number;
	description: string;
}

interface Matched {
	dedicationId: number;
	scope: DedicationScope;
}

async function queryOrEmpty<T>(sql: string, params?: unknown[]): Promise<T[]> {
	try {
		return await query<T>(sql, params);
	} catch (error) {
		if (isMissingMysqlSchema(error)) return [];
		throw error;
	}
}

/**
 * Resolves every active dedication whose direct or ancestor scope matches
 * `context`. `now` defaults to the current instant; expiry at the exact
 * instant is already hidden.
 */
export async function resolveDedications(
	context: DedicationContext,
	now: Date = new Date(),
): Promise<Dedication[]> {
	const perekIds = context.perekIds ?? [];
	const seferIds = new Set(context.seferIds ?? []);
	const helekIds = new Set(context.helekIds ?? []);
	const parashaIds = context.parashaIds ?? [];
	const entryIds = context.entryIds ?? [];
	const articleIds = context.articleIds ?? [];

	// perek -> sefer -> helek ancestor expansion over the canonical tables
	// (static corpus order = tanah_sefer.id; helek name -> tanah_helek.id).
	for (const perekId of perekIds) {
		const seferId = seferIdByPerekId(perekId);
		if (seferId !== undefined) seferIds.add(seferId);
	}
	for (const seferId of seferIds) {
		const helekId = helekIdBySeferId(seferId);
		if (helekId !== undefined) helekIds.add(helekId);
	}

	const matched: Matched[] = [];

	if (perekIds.length > 0) {
		for (const row of await queryOrEmpty<{
			perek_id_low: number;
			perek_id_high: number;
			dedication_id: number;
			expires_at: string | null;
		}>(
			"SELECT perek_id_low, perek_id_high, dedication_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_perek_dedication",
		)) {
			if (
				isActive(row.expires_at, now) &&
				perekIds.some((p) => row.perek_id_low <= p && p <= row.perek_id_high)
			) {
				matched.push({
					dedicationId: row.dedication_id,
					scope: {
						kind: "PEREK",
						perekIdLow: row.perek_id_low,
						perekIdHigh: row.perek_id_high,
						expiresAt: parseExpiryUtc(row.expires_at),
					},
				});
			}
		}
	}
	if (seferIds.size > 0) {
		for (const row of await queryOrEmpty<{
			sefer_id: number;
			dedication_id: number;
			expires_at: string | null;
		}>(
			"SELECT sefer_id, dedication_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_sefer_dedication",
		)) {
			if (isActive(row.expires_at, now) && seferIds.has(row.sefer_id)) {
				matched.push({
					dedicationId: row.dedication_id,
					scope: {
						kind: "SEFER",
						seferId: row.sefer_id,
						expiresAt: parseExpiryUtc(row.expires_at),
					},
				});
			}
		}
	}
	if (helekIds.size > 0) {
		for (const row of await queryOrEmpty<{
			helek_id: number;
			dedication_id: number;
			expires_at: string | null;
		}>(
			"SELECT helek_id, dedication_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_helek_dedication",
		)) {
			if (isActive(row.expires_at, now) && helekIds.has(row.helek_id)) {
				matched.push({
					dedicationId: row.dedication_id,
					scope: {
						kind: "HELEK",
						helekId: row.helek_id,
						expiresAt: parseExpiryUtc(row.expires_at),
					},
				});
			}
		}
	}
	if (parashaIds.length > 0) {
		for (const row of await queryOrEmpty<{
			parasha_id: number;
			dedication_id: number;
			expires_at: string | null;
		}>(
			"SELECT parasha_id, dedication_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_parasha_dedication",
		)) {
			if (isActive(row.expires_at, now) && parashaIds.includes(row.parasha_id)) {
				matched.push({
					dedicationId: row.dedication_id,
					scope: {
						kind: "PARASHA",
						parashaId: row.parasha_id,
						expiresAt: parseExpiryUtc(row.expires_at),
					},
				});
			}
		}
	}
	if (articleIds.length > 0) {
		for (const row of await queryOrEmpty<{
			article_id: number;
			dedication_id: number;
			expires_at: string | null;
		}>(
			"SELECT article_id, dedication_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_article_dedication",
		)) {
			if (isActive(row.expires_at, now) && articleIds.includes(row.article_id)) {
				matched.push({
					dedicationId: row.dedication_id,
					scope: {
						kind: "ARTICLE",
						articleId: row.article_id,
						expiresAt: parseExpiryUtc(row.expires_at),
					},
				});
			}
		}
	}
	if (entryIds.length > 0) {
		for (const row of await queryOrEmpty<{
			entry_id: string;
			dedication_id: number;
			expires_at: string | null;
		}>(
			"SELECT entry_id, dedication_id, CAST(expires_at AS CHAR) AS expires_at FROM tanahpedia_entry_dedication",
		)) {
			if (isActive(row.expires_at, now) && entryIds.includes(row.entry_id)) {
				matched.push({
					dedicationId: row.dedication_id,
					scope: {
						kind: "TANAHPEDIA_ENTRY",
						entryId: row.entry_id,
						expiresAt: parseExpiryUtc(row.expires_at),
					},
				});
			}
		}
	}
	if (context.masora === true) {
		for (const row of await queryOrEmpty<{
			dedication_id: number;
			expires_at: string | null;
		}>("SELECT dedication_id, CAST(expires_at AS CHAR) AS expires_at FROM tanah_masora_dedication")) {
			if (isActive(row.expires_at, now)) {
				matched.push({
					dedicationId: row.dedication_id,
					scope: { kind: "MASORA", expiresAt: parseExpiryUtc(row.expires_at) },
				});
			}
		}
	}

	if (matched.length === 0) return [];

	const ids = [...new Set(matched.map((m) => m.dedicationId))].sort(
		(a, b) => a - b,
	);
	const byId = new Map<number, Dedication>();
	const rows = await queryOrEmpty<DedicationRow>(
		`SELECT id, subject, CAST(expires_at AS CHAR) AS expires_at FROM tanah_dedication WHERE id IN (${ids.map(() => "?").join(", ")})`,
		ids,
	);
	for (const row of rows) {
		if (!isActive(row.expires_at, now)) continue;
		byId.set(row.id, {
			id: row.id,
			subject: row.subject,
			expiresAt: parseExpiryUtc(row.expires_at),
			purposes: [],
			scopes: [],
		});
	}
	if (byId.size === 0) return [];

	const [purposeLinks, types] = await Promise.all([
		queryOrEmpty<PurposeLinkRow>(
			`SELECT dedication_id, dedication_type_id FROM tanah_dedication_dedication_type WHERE dedication_id IN (${ids.map(() => "?").join(", ")})`,
			ids,
		),
		queryOrEmpty<TypeRow>("SELECT id, description FROM tanah_dedication_type"),
	]);
	const typeNames = new Map(types.map((t) => [t.id, t.description]));
	const purposesById = new Map<number, string[]>();
	for (const link of purposeLinks) {
		const name = typeNames.get(link.dedication_type_id);
		if (!name) continue;
		const list = purposesById.get(link.dedication_id) ?? [];
		list.push(name);
		purposesById.set(link.dedication_id, list);
	}

	const out: Dedication[] = [];
	for (const { dedicationId, scope } of matched) {
		const dedication = byId.get(dedicationId);
		if (!dedication) continue;
		if (!dedication.scopes.some((s) => sameScope(s, scope))) {
			dedication.scopes.push(scope);
		}
		if (!out.includes(dedication)) out.push(dedication);
	}
	for (const dedication of out) {
		dedication.purposes = [...(purposesById.get(dedication.id) ?? [])].sort();
	}
	out.sort((a, b) => a.id - b.id);
	return out;
}

function sameScope(a: DedicationScope, b: DedicationScope): boolean {
	return (
		a.kind === b.kind &&
		a.perekIdLow === b.perekIdLow &&
		a.perekIdHigh === b.perekIdHigh &&
		a.seferId === b.seferId &&
		a.helekId === b.helekId &&
		a.parashaId === b.parashaId &&
		a.articleId === b.articleId &&
		a.entryId === b.entryId
	);
}
