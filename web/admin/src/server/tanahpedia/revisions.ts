import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import type mysql from "mysql2/promise";
import {
	type EntryRevisionRow,
	normalizeRevisionSource,
	REVISION_SOURCE_ADMIN,
	RevisionConflictError,
	shouldSquashIntoHead,
} from "~/lib/tanahpedia/revisions-shared";
import { execute, query, transaction, txExecute, txQueryOne } from "../db";

const REVISION_COLUMNS =
	"id, entry_id, proposed_unique_name, proposed_title, proposed_content, source, notes, status, base_revision_id, created_at, updated_at";

interface HeadRevisionRow extends EntryRevisionRow {
	age_seconds: number;
}

interface EntryRow {
	id: string;
	unique_name: string;
	title: string;
	content: string | null;
	created_at: string;
	updated_at: string;
}

/** The entry's latest APPLIED revision — the row that produced its content. */
async function headRevision(
	conn: mysql.PoolConnection,
	entryId: string,
): Promise<HeadRevisionRow | null> {
	return txQueryOne<HeadRevisionRow>(
		conn,
		`SELECT ${REVISION_COLUMNS}, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds
		 FROM tanahpedia_entry_revision
		 WHERE entry_id = ? AND status = 'APPLIED'
		 ORDER BY created_at DESC, id DESC
		 LIMIT 1`,
		[entryId],
	);
}

async function lockEntry(
	conn: mysql.PoolConnection,
	entryId: string,
): Promise<EntryRow | null> {
	return txQueryOne<EntryRow>(
		conn,
		"SELECT id, unique_name, title, content, created_at, updated_at FROM tanahpedia_entry WHERE id = ? FOR UPDATE",
		[entryId],
	);
}

function assertFreshBase(
	headId: string | null,
	baseRevisionId: string | null | undefined,
): void {
	if (headId !== (baseRevisionId ?? null)) {
		throw new RevisionConflictError(
			"the entry was saved by another session since this edit started - reload and re-apply the changes",
		);
	}
}

export interface SaveEntryRevisionedInput {
	id: string;
	unique_name: string;
	title: string;
	content: string;
	baseRevisionId?: string | null;
	source?: string;
	notes?: string | null;
}

export interface SavedEntryRevisionResult {
	entry: EntryRow;
	headRevisionId: string | null;
}

/**
 * Saves entry fields and records the change as an immutable APPLIED revision
 * (wiki-style history). Serialized per entry via `FOR UPDATE` on the entry row;
 * `baseRevisionId` must equal the APPLIED head seen by the editor, otherwise a
 * `REVISION_CONFLICT` error is thrown instead of silently overwriting.
 *
 * Consecutive saves from the same source inside the squash window update the
 * head revision rather than appending a row per autosave. Pass `squash: false`
 * (e.g. restores) to always open a new revision.
 */
export const saveEntryRevisioned = createServerOnlyFn(
	async function saveEntryRevisioned(
		conn: mysql.PoolConnection,
		input: SaveEntryRevisionedInput,
		options: { squash?: boolean } = {},
	): Promise<SavedEntryRevisionResult> {
		const entry = await lockEntry(conn, input.id);
		if (!entry) throw new Error("Entry not found");

		const head = await headRevision(conn, input.id);
		assertFreshBase(head?.id ?? null, input.baseRevisionId);

		const nextContent = input.content || null;
		const unchanged =
			entry.unique_name === input.unique_name &&
			entry.title === input.title &&
			entry.content === nextContent;

		// A no-op save keeps the same head — no history spam for untouched content.
		if (unchanged) {
			return { entry, headRevisionId: head?.id ?? null };
		}

		const source = normalizeRevisionSource(input.source);
		const notes = input.notes?.trim() || null;
		let headId = head?.id ?? null;

		if (
			options.squash !== false &&
			shouldSquashIntoHead(
				head
					? { source: head.source, ageSeconds: Number(head.age_seconds) }
					: null,
				source,
			)
		) {
			await txExecute(
				conn,
				`UPDATE tanahpedia_entry_revision
			 SET proposed_unique_name = ?, proposed_title = ?, proposed_content = ?,
			     notes = COALESCE(?, notes), updated_at = NOW()
			 WHERE id = ?`,
				[
					input.unique_name,
					input.title,
					nextContent,
					notes,
					head?.id as string,
				],
			);
		} else {
			headId = crypto.randomUUID();
			await txExecute(
				conn,
				`INSERT INTO tanahpedia_entry_revision
			 (id, entry_id, proposed_unique_name, proposed_title, proposed_content,
			  source, notes, status, base_revision_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?)`,
				[
					headId,
					input.id,
					input.unique_name,
					input.title,
					nextContent,
					source,
					notes,
					head?.id ?? null,
				],
			);
		}

		await txExecute(
			conn,
			"UPDATE tanahpedia_entry SET unique_name = ?, title = ?, content = ? WHERE id = ?",
			[input.unique_name, input.title, nextContent, input.id],
		);

		const saved = await txQueryOne<EntryRow>(
			conn,
			"SELECT id, unique_name, title, content, created_at, updated_at FROM tanahpedia_entry WHERE id = ?",
			[input.id],
		);
		return { entry: saved as EntryRow, headRevisionId: headId };
	},
);

export const listEntryRevisions = createServerFn({ method: "GET" })
	.validator((data: string) => data)
	.handler(async ({ data: entryId }) => {
		return await query<EntryRevisionRow>(
			`SELECT ${REVISION_COLUMNS}
			 FROM tanahpedia_entry_revision
			 WHERE entry_id = ?
			 ORDER BY created_at DESC, id DESC`,
			[entryId],
		);
	});

/**
 * Applies a PENDING external proposal to the live entry (admin triage). Honors
 * the proposal's declared `base_revision_id` when set: applying while the head
 * has moved elsewhere is a conflict. The proposal row is retained as the
 * change's audit record and stamped with the head it displaced.
 */
export const approveEntryRevision = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		return transaction(async (conn) => {
			const revision = await txQueryOne<EntryRevisionRow>(
				conn,
				`SELECT ${REVISION_COLUMNS} FROM tanahpedia_entry_revision WHERE id = ? FOR UPDATE`,
				[data.id],
			);
			if (!revision) throw new Error("Revision not found");
			if (revision.status === "APPLIED") {
				throw new Error("revision has already been applied");
			}

			let headId: string | null = null;
			let targetEntryId = revision.entry_id;

			if (revision.entry_id) {
				const entry = await lockEntry(conn, revision.entry_id);
				if (!entry) {
					throw new Error(
						"the entry targeted by this revision no longer exists",
					);
				}
				const head = await headRevision(conn, revision.entry_id);
				headId = head?.id ?? null;
				if (revision.base_revision_id && revision.base_revision_id !== headId) {
					throw new RevisionConflictError(
						"the revision's declared base is stale - the entry head has moved",
					);
				}
				await txExecute(
					conn,
					`UPDATE tanahpedia_entry
					 SET unique_name = COALESCE(?, unique_name),
					     title = COALESCE(?, title),
					     content = COALESCE(?, content)
					 WHERE id = ?`,
					[
						revision.proposed_unique_name,
						revision.proposed_title,
						revision.proposed_content,
						revision.entry_id,
					],
				);
			} else {
				if (!revision.proposed_unique_name || !revision.proposed_title) {
					throw new Error(
						"applying a new-entry revision requires proposedUniqueName and proposedTitle",
					);
				}
				targetEntryId = crypto.randomUUID();
				await txExecute(
					conn,
					"INSERT INTO tanahpedia_entry (id, unique_name, title, content) VALUES (?, ?, ?, ?)",
					[
						targetEntryId,
						revision.proposed_unique_name,
						revision.proposed_title,
						revision.proposed_content,
					],
				);
			}

			await txExecute(
				conn,
				`UPDATE tanahpedia_entry_revision
				 SET status = 'APPLIED', entry_id = ?, base_revision_id = ?, updated_at = NOW()
				 WHERE id = ?`,
				[targetEntryId, revision.base_revision_id ?? headId, revision.id],
			);
			return {
				revisionId: revision.id,
				entryId: targetEntryId,
				headRevisionId: revision.id,
			};
		});
	});

/** Marks a PENDING external proposal as rejected. */
export const rejectEntryRevision = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		await execute(
			`UPDATE tanahpedia_entry_revision
			 SET status = 'REJECTED', updated_at = NOW()
			 WHERE id = ? AND status = 'PENDING'`,
			[data.id],
		);
		return { revisionId: data.id };
	});

/**
 * Restores an entry to the snapshot carried by an earlier revision. History is
 * never mutated: the restore itself is a new APPLIED revision based on the
 * current head. Fields the snapshot does not carry keep their current values.
 */
export const restoreEntryRevision = createServerFn({ method: "POST" })
	.validator((data: { id: string; baseRevisionId?: string | null }) => data)
	.handler(async ({ data }) => {
		return transaction(async (conn) => {
			const revision = await txQueryOne<EntryRevisionRow>(
				conn,
				`SELECT ${REVISION_COLUMNS} FROM tanahpedia_entry_revision WHERE id = ?`,
				[data.id],
			);
			if (!revision) throw new Error("Revision not found");
			if (!revision.entry_id) {
				throw new Error(
					"cannot restore a revision that is not linked to an entry",
				);
			}

			const entry = await lockEntry(conn, revision.entry_id);
			if (!entry) throw new Error("Entry not found");

			const head = await headRevision(conn, revision.entry_id);
			assertFreshBase(head?.id ?? null, data.baseRevisionId);

			const restoredUniqueName =
				revision.proposed_unique_name ?? entry.unique_name;
			const restoredTitle = revision.proposed_title ?? entry.title;
			const restoredContent = revision.proposed_content ?? entry.content;

			const headId = crypto.randomUUID();
			await txExecute(
				conn,
				`INSERT INTO tanahpedia_entry_revision
				 (id, entry_id, proposed_unique_name, proposed_title, proposed_content,
				  source, notes, status, base_revision_id)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?)`,
				[
					headId,
					revision.entry_id,
					restoredUniqueName,
					restoredTitle,
					restoredContent,
					REVISION_SOURCE_ADMIN,
					`שחזור מגרסה ${revision.id}`,
					head?.id ?? null,
				],
			);
			await txExecute(
				conn,
				"UPDATE tanahpedia_entry SET unique_name = ?, title = ?, content = ? WHERE id = ?",
				[restoredUniqueName, restoredTitle, restoredContent, revision.entry_id],
			);
			const saved = await txQueryOne<EntryRow>(
				conn,
				"SELECT id, unique_name, title, content, created_at, updated_at FROM tanahpedia_entry WHERE id = ?",
				[revision.entry_id],
			);
			return { entry: saved, headRevisionId: headId };
		});
	});
