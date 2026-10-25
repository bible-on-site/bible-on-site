/**
 * Browser-local crash/relogin-recovery draft for the entry editor.
 *
 * When a save fails (especially session expiry, where recovering requires a
 * full login round-trip that unloads the page), the in-flight editor snapshot
 * is stashed in localStorage. On the next load of the same entry the draft is
 * applied over the freshly-fetched head so the autosave can commit it; it is
 * cleared once a save is acknowledged. Scoped, deliberate, and subsumed by
 * the broader browser-draft model tracked in the companion local-draft task.
 */

export interface EntryDraftSnapshot {
	unique_name: string;
	title: string;
	content: string;
}

interface StoredDraft {
	form: EntryDraftSnapshot;
	savedAt: string;
}

const draftKey = (entryId: string) => `tanahpedia-draft:${entryId}`;

export function stashEntryDraft(
	entryId: string,
	form: EntryDraftSnapshot,
): void {
	try {
		localStorage.setItem(
			draftKey(entryId),
			JSON.stringify({ form, savedAt: new Date().toISOString() }),
		);
	} catch {
		// Storage can be unavailable (private mode/quota) — losing the stash
		// only loses the crash-recovery nicety, never the editor itself.
	}
}

export function readEntryDraft(entryId: string): StoredDraft | null {
	try {
		const raw = localStorage.getItem(draftKey(entryId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredDraft;
		if (!parsed?.form || typeof parsed.form.title !== "string") return null;
		return parsed;
	} catch {
		return null;
	}
}

export function clearEntryDraft(entryId: string): void {
	try {
		localStorage.removeItem(draftKey(entryId));
	} catch {
		// Same as stashEntryDraft — best effort.
	}
}
