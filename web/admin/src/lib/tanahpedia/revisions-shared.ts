/**
 * Shared, dependency-free helpers for the Tanahpedia entry revision history.
 * Used by both the admin server functions and the UI — must not import any
 * server-only module (db, secrets, etc).
 */

export const REVISION_SOURCE_ADMIN = "admin";
export const REVISION_SOURCE_LLM = "llm-assistant";
export type RevisionSource =
	| typeof REVISION_SOURCE_ADMIN
	| typeof REVISION_SOURCE_LLM
	| (string & {});

/** Stable message prefix the UI uses to detect optimistic-concurrency errors. */
export const REVISION_CONFLICT_PREFIX = "REVISION_CONFLICT:";

export class RevisionConflictError extends Error {
	constructor(message: string) {
		super(`${REVISION_CONFLICT_PREFIX} ${message}`);
		this.name = "RevisionConflictError";
	}
}

export function isRevisionConflictError(err: unknown): boolean {
	return err instanceof Error && err.message.includes(REVISION_CONFLICT_PREFIX);
}

export function normalizeRevisionSource(source: string | undefined): string {
	const trimmed = source?.trim();
	return trimmed ? trimmed : REVISION_SOURCE_ADMIN;
}

/** Columns shared by every query of `tanahpedia_entry_revision`. */
export interface EntryRevisionRow {
	id: string;
	entry_id: string | null;
	proposed_unique_name: string | null;
	proposed_title: string | null;
	proposed_content: string | null;
	source: string;
	notes: string | null;
	status: string;
	base_revision_id: string | null;
	created_at: string;
	updated_at: string;
}
