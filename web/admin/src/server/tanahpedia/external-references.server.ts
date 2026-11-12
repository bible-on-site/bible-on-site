import "@tanstack/react-start/server-only";
import type { PoolConnection } from "mysql2/promise";
import {
	EXTERNAL_REFERENCE_SUBJECT_KIND,
	type ExternalReferenceSource,
	normalizeExternalReferenceUrl,
} from "~/lib/tanahpedia/external-references";
import { transaction, txExecute, txQueryOne } from "../db";
import { revalidateWebsite } from "../website-revalidate";
import { pediaChangesForEntities } from "./paths";

/**
 * Admin management of entity external identifiers (#3330) — the
 * `external_reference` rows the website publishes as JSON-LD `sameAs`.
 * Records bind to the Tanahpedia entity UUID (`subject_id`), never to the
 * entry, the person/place subtype row or a display name, so they survive
 * entry relinks and renames.
 *
 * Write model: one mapping per source (the composite primary key), every
 * change in its own transaction, then the committed entity is expired on
 * the website through the shared `pedia-entity` change event.
 *
 * Stale-edit protection: `expectedUrl` is the editor's snapshot of the
 * current mapping (`null` when it saw none). Inside the transaction the
 * entity row is locked and the live URL must equal the snapshot — a
 * mismatch means another admin saved first, so the write is rejected
 * instead of silently overwriting newer data.
 *
 * Deploy ownership: every write also claims the pair in
 * `external_reference_seed` inside the same transaction. The claim ledger
 * normally records pairs the seed deploy already saw, but an entity
 * created after seeding has no claims — without recording the admin
 * removal, the next deploy would resurrect a deleted curated mapping.
 */

const STALE_MESSAGE =
	"המיפוי השתנה על ידי עורך אחר - רעננו את העמוד לפני שמירה חוזרת";

/** ER_NO_SUCH_TABLE — the external_reference deploy has not run here yet. */
function isMissingMysqlSchema(error: unknown): boolean {
	return (error as { code?: string })?.code === "ER_NO_SUCH_TABLE";
}

async function lockEntityOrThrow(
	conn: PoolConnection,
	entityId: string,
): Promise<void> {
	const entity = await txQueryOne<{ id: string }>(
		conn,
		"SELECT id FROM tanahpedia_entity WHERE id = ? FOR UPDATE",
		[entityId],
	);
	if (!entity) {
		throw new Error("היישות לא נמצאה");
	}
}

async function currentUrl(
	conn: PoolConnection,
	entityId: string,
	source: ExternalReferenceSource,
): Promise<string | null> {
	const row = await txQueryOne<{ url: string }>(
		conn,
		`SELECT url FROM external_reference
		 WHERE subject_kind = ? AND subject_id = ? AND source = ?`,
		[EXTERNAL_REFERENCE_SUBJECT_KIND, entityId, source],
	);
	return row?.url ?? null;
}

/** Marks the pair admin-owned so a deploy rerun can never reseed it. */
async function claimPair(
	conn: PoolConnection,
	entityId: string,
	source: ExternalReferenceSource,
): Promise<void> {
	await txExecute(
		conn,
		`INSERT IGNORE INTO external_reference_seed (subject_kind, subject_id, source)
		 VALUES (?, ?, ?)`,
		[EXTERNAL_REFERENCE_SUBJECT_KIND, entityId, source],
	);
}

export interface SetEntityExternalReferenceInput {
	entityId: string;
	source: ExternalReferenceSource;
	/** Editor-typed identifier/URL — normalized to the canonical form. */
	url: string;
	/** The mapping URL the editor saw, or null when it saw none. */
	expectedUrl: string | null;
}

export interface RemoveEntityExternalReferenceInput {
	entityId: string;
	source: ExternalReferenceSource;
	expectedUrl: string | null;
}

/** Adds or replaces one mapping; returns the stored canonical URL. */
export async function setEntityExternalReference(
	input: SetEntityExternalReferenceInput,
): Promise<{ url: string }> {
	const url = normalizeExternalReferenceUrl(input.source, input.url);
	try {
		await transaction(async (conn) => {
			await lockEntityOrThrow(conn, input.entityId);
			const current = await currentUrl(conn, input.entityId, input.source);
			if (current !== (input.expectedUrl ?? null)) {
				throw new Error(STALE_MESSAGE);
			}
			if (current === url) return;
			if (current === null) {
				await txExecute(
					conn,
					`INSERT INTO external_reference (subject_kind, subject_id, source, url)
					 VALUES (?, ?, ?, ?)`,
					[EXTERNAL_REFERENCE_SUBJECT_KIND, input.entityId, input.source, url],
				);
			} else {
				await txExecute(
					conn,
					`UPDATE external_reference SET url = ?
					 WHERE subject_kind = ? AND subject_id = ? AND source = ?`,
					[url, EXTERNAL_REFERENCE_SUBJECT_KIND, input.entityId, input.source],
				);
			}
			await claimPair(conn, input.entityId, input.source);
		});
	} catch (error) {
		if (isMissingMysqlSchema(error)) {
			throw new Error("טבלת external_reference עדיין לא פרוסה");
		}
		throw error;
	}
	await revalidateWebsite(await pediaChangesForEntities([input.entityId]));
	return { url };
}

/** Removes one mapping; an absent mapping is an error, never silent. */
export async function removeEntityExternalReference(
	input: RemoveEntityExternalReferenceInput,
): Promise<void> {
	try {
		await transaction(async (conn) => {
			await lockEntityOrThrow(conn, input.entityId);
			const current = await currentUrl(conn, input.entityId, input.source);
			if (current === null) {
				throw new Error("המיפוי כבר הוסר");
			}
			if (current !== (input.expectedUrl ?? null)) {
				throw new Error(STALE_MESSAGE);
			}
			await txExecute(
				conn,
				`DELETE FROM external_reference
				 WHERE subject_kind = ? AND subject_id = ? AND source = ?`,
				[EXTERNAL_REFERENCE_SUBJECT_KIND, input.entityId, input.source],
			);
			// Claim inside the same commit: a deleted pair must stay deleted
			// even when the pair was never seeded or claimed before.
			await claimPair(conn, input.entityId, input.source);
		});
	} catch (error) {
		if (isMissingMysqlSchema(error)) {
			throw new Error("טבלת external_reference עדיין לא פרוסה");
		}
		throw error;
	}
	await revalidateWebsite(await pediaChangesForEntities([input.entityId]));
}
