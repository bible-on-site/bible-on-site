import { query } from "./db";
import type { AdminTarget, DedicationTargetInput } from "./dedications";
import { dedicationChange, revalidateWebsite } from "./website-revalidate";

// --- expiry-triggered invalidation (#2731) ----------------------------------
//
// This module is deliberately server-only: nothing it exports may be
// imported from a route/client file. `server/dedications.ts` is imported by
// /dedications for its createServerFns, so the TanStack transform ships any
// of its non-serverFn exports — and their transitive imports — to the
// client. The rescan/exported scheduler surface lives here so that module's
// client stub keeps zero server imports (a previous version exported
// `rescanDedicationExpiries` from the CRUD module and pulled mysql2 into
// the browser bundle, breaking hydration on every page).
//
// Dedication expiry is clock-driven, so an instant-precise expiry needs an
// invalidation when `expires_at` passes (the website loaders carry no time
// bound — a positive `unstable_cache` `revalidate` would convert every
// statically rendered route to ISR; src/lib/dedications/loaders.ts). The
// admin server arms one wake-up per dedication at its earliest future
// expiry (own row or any link row); on wake the dedication's *current*
// scope set is emitted as the same change a save sends, and the website
// expires those surfaces.
//
// State is re-derived from the DB on every call: mid-flight edits move
// the next instant, deletes end the chain, and instants beyond the
// setTimeout cap re-arm on wake. Timers are per-instance like the
// revalidate queue (website-revalidate.ts): a restart replays the scan
// (`rescanDedicationExpiries`), and an expiry that elapsed while the
// admin was down flushes on that rescan — over-invalidation is the safe
// direction everywhere here.

/** Longest single `setTimeout` arm (~24.8 days); farther instants re-arm. */
const MAX_TIMER_MS = 2_147_483_647;
const expiryTimers = new Map<number, ReturnType<typeof setTimeout>>();

interface ExpiryState {
	/** Earliest still-future expiry instant across the row + its links (UTC). */
	next: Date | null;
	/** True when at least one stored expiry already elapsed. */
	elapsed: boolean;
}

/** The `{changes}` payload members for one dedication's assignment set. */
export function changeFromTargets(targets: AdminTarget[] | DedicationTargetInput[]) {
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

/** Merge old ∪ new assignment sets — the invalidation covers both sides. */
export function mergeChanges(id: number, oldTargets: DedicationTargetInput[], newTargets: DedicationTargetInput[]) {
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

/** The raw assignment set of a dedication, pre-commit readable (delete path). */
export async function currentTargets(id: number): Promise<DedicationTargetInput[]> {
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

async function dedicationExpiryState(id: number): Promise<ExpiryState> {
	const rows = await query<{
		next_expiry: string | null;
		has_elapsed: number;
	}>(
		`SELECT CAST(MIN(CASE WHEN e.expires_at > UTC_TIMESTAMP() THEN e.expires_at END) AS CHAR) AS next_expiry,
		        MAX(e.expires_at <= UTC_TIMESTAMP()) AS has_elapsed
		 FROM (
		     SELECT expires_at FROM tanah_dedication WHERE id = ?
		     UNION ALL SELECT expires_at FROM tanah_perek_dedication WHERE dedication_id = ?
		     UNION ALL SELECT expires_at FROM tanah_sefer_dedication WHERE dedication_id = ?
		     UNION ALL SELECT expires_at FROM tanah_helek_dedication WHERE dedication_id = ?
		     UNION ALL SELECT expires_at FROM tanah_parasha_dedication WHERE dedication_id = ?
		     UNION ALL SELECT expires_at FROM tanah_article_dedication WHERE dedication_id = ?
		     UNION ALL SELECT expires_at FROM tanahpedia_entry_dedication WHERE dedication_id = ?
		     UNION ALL SELECT expires_at FROM tanah_masora_dedication WHERE dedication_id = ?
		 ) e
		 WHERE e.expires_at IS NOT NULL`,
		[id, id, id, id, id, id, id, id],
	);
	const row = rows[0];
	return {
		next: row?.next_expiry
			? new Date(`${row.next_expiry.replace(" ", "T")}Z`)
			: null,
		elapsed: row?.has_elapsed === 1,
	};
}

/**
 * Re-derives one dedication's expiry state: flushes the scope invalidation
 * when an expiry already elapsed (the wake itself or a downtime gap) and
 * arms the next wake-up. Fire-and-forget from the mutation path — errors
 * are logged, never thrown into the editor's save response.
 */
export async function syncDedicationExpiry(id: number): Promise<void> {
	const existing = expiryTimers.get(id);
	if (existing) {
		clearTimeout(existing);
		expiryTimers.delete(id);
	}
	let state: ExpiryState;
	try {
		state = await dedicationExpiryState(id);
	} catch (error) {
		console.error(`dedication expiry state failed for ${id}:`, error);
		return;
	}
	if (state.elapsed) {
		try {
			const targets = await currentTargets(id);
			void revalidateWebsite([
				dedicationChange({ id, ...changeFromTargets(targets) }),
			]);
		} catch (error) {
			console.error(`dedication expiry flush failed for ${id}:`, error);
		}
	}
	if (state.next !== null) {
		const delay = Math.min(state.next.getTime() - Date.now(), MAX_TIMER_MS);
		const timer = setTimeout(() => {
			expiryTimers.delete(id);
			void syncDedicationExpiry(id);
		}, delay);
		timer.unref?.();
		expiryTimers.set(id, timer);
	}
}

/** Drops a pending wake-up — the delete's own invalidation already ran. */
export function clearDedicationExpiry(id: number): void {
	const existing = expiryTimers.get(id);
	if (existing) clearTimeout(existing);
	expiryTimers.delete(id);
}

/** Test hook: drops every armed expiry wake-up (same convention as
 * `__resetRevalidateForTests` in website-revalidate.ts). */
export function __resetDedicationExpiryForTests(): void {
	for (const timer of expiryTimers.values()) clearTimeout(timer);
	expiryTimers.clear();
}

/**
 * Boot catch-up: re-derives every dedication that stores any expiry —
 * arms the future instants and flushes the ones that elapsed while the
 * admin was down (their rendered surfaces may still show the retired
 * dedication). Called once from the server entry when website
 * revalidation is configured; the flushes ride the same debounced queue.
 */
export async function rescanDedicationExpiries(): Promise<void> {
	const rows = await query<{ id: number }>(
		`SELECT DISTINCT dedication_id AS id FROM (
		     SELECT id AS dedication_id, expires_at FROM tanah_dedication
		     UNION ALL SELECT dedication_id, expires_at FROM tanah_perek_dedication
		     UNION ALL SELECT dedication_id, expires_at FROM tanah_sefer_dedication
		     UNION ALL SELECT dedication_id, expires_at FROM tanah_helek_dedication
		     UNION ALL SELECT dedication_id, expires_at FROM tanah_parasha_dedication
		     UNION ALL SELECT dedication_id, expires_at FROM tanah_article_dedication
		     UNION ALL SELECT dedication_id, expires_at FROM tanahpedia_entry_dedication
		     UNION ALL SELECT dedication_id, expires_at FROM tanah_masora_dedication
		 ) expiries WHERE expires_at IS NOT NULL`,
	);
	await Promise.all(rows.map((row) => syncDedicationExpiry(row.id)));
}
