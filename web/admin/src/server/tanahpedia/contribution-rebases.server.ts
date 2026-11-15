import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import {
	CONTRIBUTION_API_VERSION,
	migrationBlocked,
} from "~/lib/tanahpedia/contribution-api";
import {
	contributionIdentifierKey,
	isContributionRecordId,
} from "~/lib/tanahpedia/contribution-identifiers";
import {
	type Contribution,
	type Contributor,
	contributionSnapshot,
	sameState,
	validateChanges,
} from "~/lib/tanahpedia/contributions";
import { query } from "../db";
import { prepareChanges } from "./contribution-changes.server";
import {
	readContribution,
	saveContribution,
	withContributions,
} from "./contribution-store.server";

const system: Contributor = {
	id: "system:contribution-rebase",
	name: "המערכת",
	kind: "system",
	isDoradsoft: false,
};
function identifiers(value: unknown, result = new Set<string>()): Set<string> {
	if (isContributionRecordId(value))
		result.add(contributionIdentifierKey(value));
	else if (Array.isArray(value))
		for (const child of value) identifiers(child, result);
	else if (value && typeof value === "object")
		for (const child of Object.values(value)) identifiers(child, result);
	return result;
}
function changesAddressSpace(item: Contribution): boolean {
	return item.changes.some(
		(c) => c.kind === "entry" || c.kind === "alias_mapping",
	);
}
function affected(
	item: Contribution,
	changed: Set<string>,
	addressesChanged: boolean,
): boolean {
	return (
		Boolean(item.domainConflict || item.deferredContentMerge) ||
		(addressesChanged && changesAddressSpace(item)) ||
		[...identifiers(item.changes)].some((id) => changed.has(id))
	);
}
function changedSequence(
	item: Contribution,
	trigger: Pick<Contribution, "number">,
	error?: string,
): void {
	const snapshot = contributionSnapshot(item);
	item.revision++;
	// A refreshed before-state changes the reviewed diff, including for PRs
	// originally authored by the owner. Only a fresh owner action clears it.
	item.revisionAuthor = system;
	item.events.push({
		id: randomUUID(),
		kind: "rebased",
		actor: system,
		revision: item.revision,
		at: new Date().toISOString(),
		snapshot,
		body: error
			? `לא ניתן לרענן את ההשוואה אחרי PR #${trigger.number}: ${error}`
			: `בסיס ההשוואה רוענן אחרי PR #${trigger.number}. הערכים המוצעים נשמרו; נדרשת סקירה מחודשת של doradsoft.`,
	});
}
async function refreshContributionBase(
	conn: PoolConnection,
	item: Contribution,
	trigger: Pick<Contribution, "number">,
): Promise<"refreshed" | "blocked" | "unchanged"> {
	const deferred = Boolean(item.deferredContentMerge);
	delete item.deferredContentMerge;
	let next: Contribution["changes"];
	try {
		const inputs = item.changes.length
			? validateChanges(
					item.changes.map((c) => ({
						kind: c.kind,
						targetId: c.targetId,
						after: c.after,
					})),
				)
			: [];
		next = await prepareChanges(conn, inputs, { refresh: true });
	} catch (error) {
		// A storage failure rolls back this transaction and retains its marker.
		if (error && typeof error === "object" && "code" in error) throw error;
		const message =
			error instanceof Error
				? error.message
				: "The target can no longer be refreshed";
		if (item.domainConflict === message) {
			if (deferred) await saveContribution(conn, item);
			return "unchanged";
		}
		changedSequence(item, trigger, message);
		item.domainConflict = message;
		await saveContribution(conn, item);
		return "blocked";
	}
	if (sameState(next, item.changes) && !item.domainConflict) {
		if (deferred) await saveContribution(conn, item);
		return "unchanged";
	}
	changedSequence(item, trigger);
	item.changes = next;
	delete item.domainConflict;
	item.apiVersion = CONTRIBUTION_API_VERSION;
	await saveContribution(conn, item);
	return "refreshed";
}

/** API conversion itself retains approval. Reconcile a separately recorded
 * content merge only after the sequence is executable in the latest API. */
export async function refreshDeferredContributionBase(
	conn: PoolConnection,
	item: Contribution,
): Promise<void> {
	if (
		item.kind !== "pr" ||
		item.state !== "open" ||
		migrationBlocked(item) ||
		!item.deferredContentMerge
	)
		return;
	await refreshContributionBase(conn, item, item.deferredContentMerge);
}

export async function refreshPendingContributionBases(trigger: Contribution) {
	const changed = identifiers(trigger.changes);
	const addressesChanged = changesAddressSpace(trigger);
	const renamed = trigger.changes
		.filter((c) => c.kind === "metadata")
		.map((c) => c.targetId);
	if (renamed.length) {
		const roots = [
			"person",
			"place",
			"nation",
			"event",
			"war",
			"animal",
			"object",
			"temple_tool",
			"plant",
			"astronomical_object",
			"sefer",
			"saying",
			"prophecy",
		];
		const rows = await query<{ id: string }>(
			roots
				.map(
					(kind) =>
						`SELECT id FROM tanahpedia_${kind} WHERE entity_id IN (${renamed.map(() => "?").join(",")})`,
				)
				.join(" UNION ALL "),
			roots.flatMap(() => renamed),
		);
		for (const row of rows) changed.add(contributionIdentifierKey(row.id));
	}
	const [{ lastNumber }] = await query<{ lastNumber: number }>(
		"SELECT COALESCE(MAX(number),0) AS lastNumber FROM tanahpedia_contribution",
	);
	const result = { scanned: 0, refreshed: 0, blocked: 0 };
	let cursor = 0;
	while (cursor < Number(lastNumber)) {
		const rows = await query<{
			id: string;
			number: number;
			data: Contribution | string;
		}>(
			"SELECT id,number,data FROM tanahpedia_contribution WHERE kind='pr' AND state='open' AND number>? AND number<=? ORDER BY number LIMIT 100",
			[cursor, Number(lastNumber)],
		);
		if (!rows.length) break;
		for (const row of rows) {
			result.scanned++;
			const candidate =
				typeof row.data === "string"
					? (JSON.parse(row.data) as Contribution)
					: row.data;
			if (
				!affected(candidate, changed, addressesChanged) &&
				!migrationBlocked(candidate)
			)
				continue;
			const outcome = await withContributions(async (conn) => {
				const item = await readContribution(conn, row.id, true);
				if (item.kind !== "pr" || item.state !== "open") return "unchanged";
				if (migrationBlocked(item)) {
					if (!item.deferredContentMerge) {
						item.deferredContentMerge = {
							id: trigger.id,
							number: trigger.number,
						};
						await saveContribution(conn, item);
					}
					return "unchanged";
				}
				if (!affected(item, changed, addressesChanged)) return "unchanged";
				return refreshContributionBase(conn, item, trigger);
			});
			if (outcome !== "unchanged") result[outcome]++;
		}
		cursor = Number(rows[rows.length - 1].number);
	}
	return result;
}
/** The pending bit commits with the content merge. Replaying after interruption
 * is idempotent: equal bases do not create another revision or event. */
export async function resumePendingContributionRebases() {
	let cursor = 0;
	for (;;) {
		const rows = await query<{ id: string; number: number }>(
			"SELECT id,number FROM tanahpedia_contribution WHERE kind='pr' AND state='merged' AND JSON_EXTRACT(data,'$.rebasePending')=true AND number>? ORDER BY number LIMIT 100",
			[cursor],
		);
		if (!rows.length) return;
		for (const row of rows) {
			const trigger = await withContributions((conn) =>
				readContribution(conn, row.id),
			);
			if (trigger.rebasePending) {
				await refreshPendingContributionBases(trigger);
				await withContributions(async (conn) => {
					const current = await readContribution(conn, row.id, true);
					if (current.rebasePending) {
						delete current.rebasePending;
						await saveContribution(conn, current);
					}
				});
			}
		}
		cursor = Number(rows[rows.length - 1].number);
	}
}
