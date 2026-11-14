/**
 * Browser-local drafts for the Tanahpedia entry editor.
 *
 * Drafts are the ONLY automatic persistence: while editing, the form mirrors
 * into localStorage under a key scoped by the authenticated editor and the
 * entry (or a stable per-session id for unsaved entries). Nothing reaches
 * the server until an explicit commit — drafts never create revisions, move
 * `updated_at`, or touch public content.
 *
 * The stored payload is versioned and carries the head revision the edits
 * were based on, the writing tab's session id, and the save's attribution
 * (source/notes) so a restore preserves exactly what a commit would carry.
 */

export const LOCAL_DRAFT_VERSION = 2;

export interface EntryDraftSnapshot {
	unique_name: string;
	title: string;
	content: string;
}

export interface StoredEntryDraft {
	version: typeof LOCAL_DRAFT_VERSION;
	/** Cognito `sub` (or "local" under SKIP_AUTH) the draft belongs to. */
	accountId: string;
	/** Identity inside the account scope: `entry:<id>` or `new:<uuid>`. */
	scope: string;
	/** The tab/window that wrote the draft — cross-tab writes are surfaced. */
	sessionId: string;
	/** The APPLIED head revision the edits were based on. */
	baseRevisionId: string | null;
	savedAt: string;
	form: EntryDraftSnapshot;
	source: string;
	notes: string | null;
}

export type DraftReadResult =
	| { kind: "none" }
	| { kind: "ok"; draft: StoredEntryDraft }
	| { kind: "malformed" };

const KEY_PREFIX = "tanahpedia-draft:v2";
/** Issue #2611's unscoped stash — adopted once into the scoped model. */
const LEGACY_KEY_PREFIX = "tanahpedia-draft:";

export const entryDraftScope = (entryId: string) => `entry:${entryId}`;
export const newEntryDraftScope = (draftId: string) => `new:${draftId}`;

export function draftKey(accountId: string, scope: string): string {
	return `${KEY_PREFIX}:${accountId}:${scope}`;
}

/** Returns false when storage is unavailable or full — callers surface it. */
export function writeEntryDraft(
	key: string,
	payload: StoredEntryDraft,
): boolean {
	try {
		localStorage.setItem(key, JSON.stringify(payload));
		return true;
	} catch {
		return false;
	}
}

export function readEntryDraft(key: string): DraftReadResult {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) return { kind: "none" };
		const parsed = JSON.parse(raw) as Partial<StoredEntryDraft> | null;
		if (
			parsed?.version !== LOCAL_DRAFT_VERSION ||
			typeof parsed.accountId !== "string" ||
			typeof parsed.scope !== "string" ||
			typeof parsed.savedAt !== "string" ||
			typeof parsed.form !== "object" ||
			parsed.form === null ||
			typeof parsed.form.unique_name !== "string" ||
			typeof parsed.form.title !== "string" ||
			typeof parsed.form.content !== "string"
		) {
			return { kind: "malformed" };
		}
		return {
			kind: "ok",
			draft: {
				...parsed,
				sessionId: parsed.sessionId ?? "",
				baseRevisionId: parsed.baseRevisionId ?? null,
				source: parsed.source ?? "admin",
				notes: parsed.notes ?? null,
			} as StoredEntryDraft,
		};
	} catch {
		return { kind: "malformed" };
	}
}

export function clearEntryDraft(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// Best effort — a stuck draft only means an extra recovery offer.
	}
}

/** Drafts of not-yet-created entries under one account, newest first. */
export function listNewEntryDrafts(accountId: string): StoredEntryDraft[] {
	const prefix = `${KEY_PREFIX}:${accountId}:new:`;
	const drafts: StoredEntryDraft[] = [];
	try {
		for (let i = 0; i < localStorage.length; i += 1) {
			const key = localStorage.key(i);
			if (!key?.startsWith(prefix)) continue;
			const result = readEntryDraft(key);
			if (result.kind === "ok") drafts.push(result.draft);
		}
	} catch {
		return [];
	}
	return drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

// ── Legacy v1 stash (issue #2611) ────────────────────────────────────────
// The failure-path stash predates the scoped draft model. It is read once
// for continuity and removed after adoption or discard.

export interface LegacyEntryDraft {
	form: EntryDraftSnapshot;
	baseRevisionId: string | null;
	savedAt: string;
}

export function readLegacyEntryDraft(entryId: string): LegacyEntryDraft | null {
	try {
		const raw = localStorage.getItem(`${LEGACY_KEY_PREFIX}${entryId}`);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as LegacyEntryDraft;
		if (typeof parsed?.form?.title !== "string") return null;
		return { ...parsed, baseRevisionId: parsed.baseRevisionId ?? null };
	} catch {
		return null;
	}
}

export function clearLegacyEntryDraft(entryId: string): void {
	try {
		localStorage.removeItem(`${LEGACY_KEY_PREFIX}${entryId}`);
	} catch {
		// Best effort, same as clearEntryDraft.
	}
}
