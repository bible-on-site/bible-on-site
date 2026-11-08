import { createServerFn } from "@tanstack/react-start";
import type mysql from "mysql2/promise";
import { VALIDATION_PREFIX } from "~/lib/server-fn-errors";
import {
	aliasKindForTargetCount,
	dedupeAliasTargets,
	normalizePediaName,
	reservedCategoryLabelFor,
	sameAliasTargetSet,
	validateAliasSpec,
} from "~/lib/tanahpedia/pedia-names";
import { RevisionConflictError } from "~/lib/tanahpedia/revisions-shared";
import {
	query,
	queryOne,
	transaction,
	txExecute,
	txQuery,
	txQueryOne,
} from "../db";
import {
	pediaEntryPath,
	pediaInvalidation,
	revalidateWebsite,
} from "../website-revalidate";

/**
 * Admin management of an entry's public address names — the aliases stored in
 * `tanahpedia_entry_synonym` (+ per-target distinguishing labels in
 * `tanahpedia_entry_synonym_disambiguation`).
 *
 * Public contract (website `getEntriesBySynonym`/`resolveSynonymSlug`):
 * - a name with one distinct target redirects to that entry's main URL;
 * - a name with several distinct targets renders a disambiguation page whose
 *   per-target text comes from the disambiguation label rows;
 * - a canonical `unique_name` always wins over alias rows of the same name.
 *
 * Write model (symmetric): each (name, entry) association is one synonym row;
 * while a name is shared, every association also carries a disambiguation row
 * under its own synonym row with that target's label. Removing one entry's
 * association deletes only its rows — other targets' associations survive.
 *
 * Every write is one transaction so a name can never be left half-linked, and
 * commits notify the website through the shared revalidation lifecycle.
 */

export interface AliasTarget {
	entryId: string;
	uniqueName: string;
	title: string;
	label: string | null;
}

export type PediaNameStatus =
	| { kind: "free"; name: string }
	| { kind: "invalid"; name: string; reason: string }
	| { kind: "reserved"; name: string; categoryLabel: string }
	| { kind: "self-main"; name: string; aliasTargets: AliasTarget[] }
	| {
			kind: "canonical";
			name: string;
			entry: { id: string; uniqueName: string; title: string };
			aliasTargets: AliasTarget[];
	  }
	| { kind: "alias"; name: string; targets: AliasTarget[] };

export interface EntryAliasView {
	name: string;
	kind: "alias" | "disambiguation";
	targets: AliasTarget[];
	/** Set when a canonical unique_name shadows this name (it is unreachable). */
	shadowedByCanonical: {
		entryId: string;
		uniqueName: string;
		title: string;
	} | null;
	/** True when the name equals this entry's own unique_name. */
	isSelfMain: boolean;
	/** Category label when the name collides with a reserved category route. */
	reservedCategory: string | null;
}

/** The same target set the public resolver computes for a name. */
const ALIAS_TARGETS_SQL = `SELECT e.id AS entryId, e.unique_name AS uniqueName, e.title AS title,
        NULL AS label
   FROM tanahpedia_entry_synonym s
   JOIN tanahpedia_entry e ON e.id = s.entry_id
  WHERE s.name = ?
  UNION
 SELECT e.id AS entryId, e.unique_name AS uniqueName, e.title AS title,
        d.disambiguation_label AS label
   FROM tanahpedia_entry_synonym s
   JOIN tanahpedia_entry_synonym_disambiguation d ON d.synonym_id = s.id
   JOIN tanahpedia_entry e ON e.id = d.entry_id
  WHERE s.name = ?`;

/** Dedupe by entry — a labelled row wins so no label is lost to a plain one. */
function mergeTargets(rows: AliasTarget[]): AliasTarget[] {
	const byId = new Map<string, AliasTarget>();
	for (const row of rows) {
		const current = byId.get(row.entryId);
		if (!current || (!current.label && row.label)) {
			byId.set(row.entryId, row);
		}
	}
	return [...byId.values()];
}

function placeholders(count: number): string {
	return Array.from({ length: count }, () => "?").join(", ");
}

async function loadAliasTargets(name: string): Promise<AliasTarget[]> {
	return mergeTargets(
		await query<AliasTarget>(ALIAS_TARGETS_SQL, [name, name]),
	);
}

async function loadAliasTargetsTx(
	conn: mysql.PoolConnection,
	name: string,
): Promise<AliasTarget[]> {
	return mergeTargets(
		await txQuery<AliasTarget>(conn, ALIAS_TARGETS_SQL, [name, name]),
	);
}

function validationError(message: string): Error {
	return new Error(`${VALIDATION_PREFIX}: ${message}`);
}

/**
 * Locks the name's existing rows for update so concurrent writers serialize.
 * `name` has no index, so under MySQL's default REPEATABLE READ the locking
 * scan next-key-locks the whole table — first writes of the same name
 * serialize too, and the expectedTargets check that follows sees the
 * just-committed winner's rows (locking reads bypass the snapshot). Under
 * READ COMMITTED only existing rows lock; a racing first save then merges
 * rows, which the target-dedupe reads still resolve consistently, and the
 * stale-baseline check catches what the lock could not.
 */
async function lockAliasName(
	conn: mysql.PoolConnection,
	name: string,
): Promise<void> {
	await txQuery(
		conn,
		"SELECT id FROM tanahpedia_entry_synonym WHERE name = ? FOR UPDATE",
		[name],
	);
}

/** Alias/disambiguation names this entry is a target of, with full context. */
export const getEntryAliases = createServerFn({ method: "GET" })
	.validator((data: string) => data)
	.handler(async ({ data: entryId }): Promise<EntryAliasView[]> => {
		const nameRows = await query<{ name: string }>(
			`SELECT DISTINCT name FROM (
			   SELECT s.name AS name FROM tanahpedia_entry_synonym s WHERE s.entry_id = ?
			   UNION
			   SELECT s2.name AS name
			     FROM tanahpedia_entry_synonym_disambiguation d
			     JOIN tanahpedia_entry_synonym s2 ON s2.id = d.synonym_id
			    WHERE d.entry_id = ?
			 ) names
			 ORDER BY name`,
			[entryId, entryId],
		);

		return await Promise.all(
			nameRows.map(async ({ name }) => {
				const [targets, holder] = await Promise.all([
					loadAliasTargets(name),
					queryOne<{ id: string; unique_name: string; title: string }>(
						"SELECT id, unique_name, title FROM tanahpedia_entry WHERE unique_name = ?",
						[name],
					),
				]);
				return {
					name,
					kind: aliasKindForTargetCount(targets.length),
					targets,
					shadowedByCanonical:
						holder && holder.id !== entryId
							? {
									entryId: holder.id,
									uniqueName: holder.unique_name,
									title: holder.title,
								}
							: null,
					isSelfMain: holder?.id === entryId,
					reservedCategory: reservedCategoryLabelFor(name),
				} satisfies EntryAliasView;
			}),
		);
	});

/**
 * Live status of a candidate name — drives both the main-address field
 * (`forEntryId` = the edited entry) and the alias editor's name lookup.
 */
export const checkPediaName = createServerFn({ method: "GET" })
	.validator((data: { name: string; forEntryId?: string | null }) => data)
	.handler(async ({ data }): Promise<PediaNameStatus> => {
		const name = normalizePediaName(data.name ?? "");
		if (!name) {
			return { kind: "invalid", name, reason: "שם הכתובת חייב להיות מלא" };
		}
		if (name.includes("/")) {
			return {
				kind: "invalid",
				name,
				reason: "שם הכתובת אינו יכול להכיל '/'",
			};
		}
		if (name.length > 255) {
			return {
				kind: "invalid",
				name,
				reason: "שם הכתובת ארוך מדי (עד 255 תווים)",
			};
		}

		const categoryLabel = reservedCategoryLabelFor(name);
		if (categoryLabel) {
			return { kind: "reserved", name, categoryLabel };
		}

		const holder = await queryOne<{
			id: string;
			unique_name: string;
			title: string;
		}>(
			"SELECT id, unique_name, title FROM tanahpedia_entry WHERE unique_name = ?",
			[name],
		);
		if (holder) {
			const aliasTargets = await loadAliasTargets(name);
			if (holder.id === data.forEntryId) {
				return { kind: "self-main", name, aliasTargets };
			}
			return {
				kind: "canonical",
				name,
				entry: {
					id: holder.id,
					uniqueName: holder.unique_name,
					title: holder.title,
				},
				aliasTargets,
			};
		}

		const targets = await loadAliasTargets(name);
		if (targets.length > 0) {
			return { kind: "alias", name, targets };
		}
		return { kind: "free", name };
	});

/**
 * Replaces the whole target set of a name atomically — one target makes it a
 * plain alias, several make it a disambiguation page (labels required).
 * Adding or removing a single target is enough to flip the public behavior.
 *
 * `expectedTargets` is the snapshot the editor opened with (an empty array for
 * a name that was free then): because the save replaces the complete shared
 * set, a name that drifted under it is rejected as a conflict instead of
 * silently overwriting another admin's edit.
 */
export const saveEntryAlias = createServerFn({ method: "POST" })
	.validator(
		(data: {
			name: string;
			targets: { entryId: string; label?: string | null }[];
			expectedTargets: { entryId: string; label?: string | null }[];
		}) => data,
	)
	.handler(async ({ data }) => {
		const name = normalizePediaName(data.name ?? "");
		const targets = dedupeAliasTargets(
			(data.targets ?? []).map((t) => ({
				entryId: t.entryId,
				label: t.label ?? "",
			})),
		);
		const spec = validateAliasSpec(name, targets);
		if (!spec.ok) throw validationError(spec.error);
		const reserved = reservedCategoryLabelFor(name);
		if (reserved) {
			throw validationError(
				`השם «${name}» שמור לנתיב הקטגוריה «${reserved}» - בחר שם אחר`,
			);
		}

		const saved = await transaction(async (conn) => {
			await lockAliasName(conn, name);
			const holder = await txQueryOne<{ id: string; title: string }>(
				conn,
				"SELECT id, title FROM tanahpedia_entry WHERE unique_name = ?",
				[name],
			);
			if (holder) {
				throw validationError(
					`השם «${name}» הוא הכתובת הראשית של הערך «${holder.title}» - שנה תחילה את הכתובת הראשית של אותו ערך`,
				);
			}
			// Compare while holding the name lock: any concurrent writer who
			// slipped in first is visible here (locking reads see the latest
			// committed rows), so a stale editor never replaces what it never saw.
			const current = await loadAliasTargetsTx(conn, name);
			if (!sameAliasTargetSet(current, data.expectedTargets ?? [])) {
				throw new RevisionConflictError(
					`the name "${name}" was changed by another admin since this edit opened - close the editor and reopen it to see the current state`,
				);
			}
			const idRows = await txQuery<{ id: string }>(
				conn,
				`SELECT id FROM tanahpedia_entry WHERE id IN (${placeholders(targets.length)})`,
				targets.map((t) => t.entryId),
			);
			if (idRows.length !== targets.length) {
				throw validationError("אחד היעדים אינו ערך קיים - רענן ונסה שוב");
			}

			// Replace-in-transaction: old rows (and their label rows, via FK
			// cascade) go, the new symmetric model lands in the same commit.
			await txExecute(
				conn,
				"DELETE FROM tanahpedia_entry_synonym WHERE name = ?",
				[name],
			);
			const shared = targets.length > 1;
			for (const target of targets) {
				const synonymId = crypto.randomUUID();
				await txExecute(
					conn,
					"INSERT INTO tanahpedia_entry_synonym (id, name, entry_id) VALUES (?, ?, ?)",
					[synonymId, name, target.entryId],
				);
				if (shared) {
					await txExecute(
						conn,
						`INSERT INTO tanahpedia_entry_synonym_disambiguation
						 (id, synonym_id, entry_id, disambiguation_label)
						 VALUES (?, ?, ?, ?)`,
						[crypto.randomUUID(), synonymId, target.entryId, target.label],
					);
				}
			}
			return {
				name,
				targetCount: targets.length,
				kind: aliasKindForTargetCount(targets.length),
			};
		});

		// Surface the invalidation outcome so the editor can warn when the
		// public site still serves the previous name/content (#2763).
		const websiteFresh = await revalidateWebsite(
			pediaInvalidation(pediaEntryPath(name)),
		);
		return { ...saved, websiteFresh };
	});

/**
 * Removes one entry's association from a name — other entries' associations
 * are never touched. When a single target remains the leftover label rows are
 * dropped (a plain alias shows no distinguishing text anyway).
 */
export const removeEntryFromAlias = createServerFn({ method: "POST" })
	.validator((data: { name: string; entryId: string }) => data)
	.handler(async ({ data }) => {
		const name = normalizePediaName(data.name ?? "");
		if (!name) throw validationError("שם הכתובת חייב להיות מלא");

		const result = await transaction(async (conn) => {
			await lockAliasName(conn, name);
			await txExecute(
				conn,
				"DELETE FROM tanahpedia_entry_synonym WHERE name = ? AND entry_id = ?",
				[name, data.entryId],
			);
			// Defensive: stray label rows for this entry under other rows of the
			// same name (legacy arrangements) go with its association.
			await txExecute(
				conn,
				`DELETE d FROM tanahpedia_entry_synonym_disambiguation d
				 JOIN tanahpedia_entry_synonym s ON s.id = d.synonym_id
				 WHERE s.name = ? AND d.entry_id = ?`,
				[name, data.entryId],
			);
			const targets = await loadAliasTargetsTx(conn, name);
			if (targets.length <= 1) {
				await txExecute(
					conn,
					`DELETE d FROM tanahpedia_entry_synonym_disambiguation d
					 JOIN tanahpedia_entry_synonym s ON s.id = d.synonym_id
					 WHERE s.name = ?`,
					[name],
				);
			}
			return { name, remainingTargets: targets.length };
		});

		const websiteFresh = await revalidateWebsite(
			pediaInvalidation(pediaEntryPath(name)),
		);
		return { ...result, websiteFresh };
	});

/** Deletes the name entirely — every entry's association with it. */
export const deleteAliasName = createServerFn({ method: "POST" })
	.validator((data: { name: string }) => data)
	.handler(async ({ data }) => {
		const name = normalizePediaName(data.name ?? "");
		if (!name) throw validationError("שם הכתובת חייב להיות מלא");

		const removed = await transaction(async (conn) => {
			await lockAliasName(conn, name);
			const targets = await loadAliasTargetsTx(conn, name);
			await txExecute(
				conn,
				"DELETE FROM tanahpedia_entry_synonym WHERE name = ?",
				[name],
			);
			return { name, removedTargets: targets.length };
		});

		const websiteFresh = await revalidateWebsite(
			pediaInvalidation(pediaEntryPath(name)),
		);
		return { ...removed, websiteFresh };
	});

/**
 * The transactional helpers used by the entry save path
 * (`keepOldNameAsAliasInTx`, `dropSelfShadowedAliasInTx`) live in
 * `alias-ops.server.ts`: plain functions exported here stay live in the
 * client bundle and would drag `../db`/`mysql2` into it.
 */
