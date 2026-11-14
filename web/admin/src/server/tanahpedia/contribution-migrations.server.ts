import { randomUUID } from "node:crypto";
import {
	type AsyncApiVersionAdapter,
	convertApiVersionAsync,
} from "~/lib/tanahpedia/api-versions";
import {
	CONTRIBUTION_API_VERSION,
	type ContributionApiMigration,
	contributionApiVersion,
	validateApiSequence,
} from "~/lib/tanahpedia/contribution-api";
import type { Contribution } from "~/lib/tanahpedia/contributions";
import { query } from "../db";
import { currentContributionApiContract } from "./contribution-api-adapters.server";
import {
	ensureContributionSchema,
	readContribution,
	saveContribution,
	withContributions,
} from "./contribution-store.server";

export interface ContributionApiContract {
	version: number;
	adapters: readonly AsyncApiVersionAdapter<unknown>[];
}
const CURRENT_CONTRACT: ContributionApiContract = {
	version: CONTRIBUTION_API_VERSION,
	adapters: [],
};

/** Migrations deliberately preserve revision and all approval events, including
 * when an adapter drops fields or removes an operation entirely. */
export async function migrateContributionSequence(
	item: Contribution,
	contract = CURRENT_CONTRACT,
): Promise<"migrated" | "failed" | "unchanged"> {
	if (item.kind !== "pr" || item.state !== "open") return "unchanged";
	const from = contributionApiVersion(item),
		to = contract.version;
	const original = structuredClone(item.changes);
	let migration: ContributionApiMigration;
	try {
		const converted = await convertApiVersionAsync<unknown>(
			original,
			from,
			to,
			contract.adapters,
		);
		const changes = validateApiSequence(converted.payload);
		if (from === to && item.apiMigration?.status !== "failed")
			return "unchanged";
		migration = {
			status: "succeeded",
			id: randomUUID(),
			from,
			to,
			at: new Date().toISOString(),
			steps: converted.steps,
			error: null,
			sequence: JSON.stringify(original),
		};
		item.changes = changes;
		item.apiVersion = to;
	} catch (error) {
		// Adapter lookup failures are infrastructure failures, not incompatible
		// content. Preserve the row and fail the CD hook for a later retry.
		let cause: unknown = error;
		for (let depth = 0; depth < 8 && cause instanceof Error; depth++) {
			if ("code" in cause) throw cause;
			cause = cause.cause;
		}
		const message =
			error instanceof Error ? error.message : "Unsupported API sequence";
		if (
			item.apiMigration?.status === "failed" &&
			item.apiMigration.from === from &&
			item.apiMigration.to === to &&
			item.apiMigration.error === message &&
			item.apiMigration.sequence === JSON.stringify(original)
		)
			return "unchanged";
		migration = {
			status: "failed",
			id: randomUUID(),
			from,
			to,
			at: new Date().toISOString(),
			steps: [],
			error: message,
			sequence: JSON.stringify(original),
		};
	}
	item.apiMigration = migration;
	item.apiMigrationHistory = [
		...(item.apiMigrationHistory ?? []),
		structuredClone(migration),
	];
	return migration.status === "succeeded" ? "migrated" : "failed";
}

/** Keyset scan covers every open PR, independently of the UI's page size.
 * Each row is locked and committed separately. Conversion failures turn gray;
 * storage or infrastructure failures reject the deployment hook for retry. */
export async function migrateOpenContributionPrs(
	contract?: ContributionApiContract,
) {
	await ensureContributionSchema();
	const [{ lastNumber }] = await query<{ lastNumber: number }>(
		"SELECT COALESCE(MAX(number), 0) AS lastNumber FROM tanahpedia_contribution",
	);
	const result = {
		apiVersion: contract?.version ?? CONTRIBUTION_API_VERSION,
		scanned: 0,
		migrated: 0,
		failed: 0,
		unchanged: 0,
	};
	let cursor = 0;
	while (cursor < Number(lastNumber)) {
		const rows = await query<{ id: string; number: number }>(
			"SELECT id, number FROM tanahpedia_contribution WHERE kind = 'pr' AND state = 'open' AND number > ? AND number <= ? ORDER BY number LIMIT 100",
			[cursor, Number(lastNumber)],
		);
		if (rows.length === 0) break;
		for (const row of rows) {
			const outcome = await withContributions(async (conn) => {
				const item = await readContribution(conn, row.id, true);
				const outcome = await migrateContributionSequence(
					item,
					contract ?? currentContributionApiContract(conn),
				);
				if (outcome !== "unchanged") await saveContribution(conn, item);
				return item.apiMigration?.status === "failed" && item.state === "open"
					? "failed"
					: outcome;
			});
			result.scanned++;
			result[outcome]++;
		}
		cursor = Number(rows[rows.length - 1].number);
	}
	return result;
}

let startup: Promise<unknown> | undefined;
export function ensureContributionMigrationsStarted(): void {
	if (startup) return;
	startup = migrateOpenContributionPrs().catch((error: unknown) => {
		startup = undefined;
		console.error(
			"Contribution API startup migration failed",
			error instanceof Error ? error.message : "unknown error",
		);
	});
}
