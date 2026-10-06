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

/**
 * Consecutive autosaves from the same source within this window squash into
 * the head revision instead of creating a new row — the wiki history should
 * capture edit bursts, not every 2-second debounce.
 */
export const REVISION_SQUASH_WINDOW_SECONDS = 10 * 60;

/** Stable message prefix the UI uses to detect optimistic-concurrency errors. */
export const REVISION_CONFLICT_PREFIX = "REVISION_CONFLICT:";

export class RevisionConflictError extends Error {
	constructor(message: string) {
		super(`${REVISION_CONFLICT_PREFIX} ${message}`);
		this.name = "RevisionConflictError";
	}
}

export function isRevisionConflictError(err: unknown): boolean {
	return (
		err instanceof Error && err.message.includes(REVISION_CONFLICT_PREFIX)
	);
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

/**
 * Decides whether a new save from `source` should squash into `head` (the
 * entry's latest APPLIED revision) instead of opening a new revision.
 * `ageSeconds` is the head's age measured on the database clock.
 */
export function shouldSquashIntoHead(
	head: { source: string; ageSeconds: number } | null,
	source: string,
	windowSeconds = REVISION_SQUASH_WINDOW_SECONDS,
): boolean {
	return (
		head !== null &&
		head.source === source &&
		head.ageSeconds < windowSeconds
	);
}
