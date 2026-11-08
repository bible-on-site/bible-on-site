import { useSyncExternalStore } from "react";

/**
 * Multi-pasuk selection on a Sefer (flipbook) scripture page (#2544 item 3).
 *
 * While selection mode is on for a perek, its pasuk letters act as toggles
 * instead of their recitation/commentary-navigation behaviour; the facing
 * commentary panel filters its groups to the selected pesukim. An empty set
 * means "the whole perek" — the store drops the perek's entry so nothing
 * ever filters to zero pesukim by accident.
 *
 * Keyed by canonical perek id like the pasuk-navigation registry, so the
 * flipbook's neighbouring mounted pages never leak selections across
 * perakim. Kept outside React so toggles re-render only subscribed
 * controls, never the book page.
 */
const EMPTY: ReadonlySet<number> = new Set<number>();
const selectionByPerek = new Map<number, Set<number>>();
const modeByPerek = new Set<number>();
const listeners = new Set<() => void>();

function notify(): void {
	for (const listener of listeners) listener();
}

/** Whether pasuk-letter selection mode is on for this perek's page. */
export function isSeferPasukSelectionMode(perekId: number): boolean {
	return modeByPerek.has(perekId);
}

/** Toggles pasuk-letter selection mode for one perek's scripture page. */
export function setSeferPasukSelectionMode(perekId: number, on: boolean): void {
	if (on === modeByPerek.has(perekId)) return;
	if (on) modeByPerek.add(perekId);
	else modeByPerek.delete(perekId);
	notify();
}

/** The perek's selected pesukim (empty set = no filter: the whole perek). */
export function getSeferPasukSelection(perekId: number): ReadonlySet<number> {
	return selectionByPerek.get(perekId) ?? EMPTY;
}

/** Toggles one pasuk in the perek's selection. */
export function toggleSeferPasuk(perekId: number, pasuk: number): void {
	const next = new Set(selectionByPerek.get(perekId));
	if (next.has(pasuk)) next.delete(pasuk);
	else next.add(pasuk);
	if (next.size === 0) selectionByPerek.delete(perekId);
	else selectionByPerek.set(perekId, next);
	notify();
}

/** Clears the perek's selection — commentary returns to the whole perek. */
export function clearSeferPasukSelection(perekId: number): void {
	if (!selectionByPerek.delete(perekId)) return;
	notify();
}

/** Test/harness reset: drops all selections and modes. */
export function resetSeferPasukSelectionState(): void {
	selectionByPerek.clear();
	modeByPerek.clear();
	notify();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** React binding for the perek's selected pesukim (stable empty set). */
export function useSeferPasukSelection(perekId: number): ReadonlySet<number> {
	return useSyncExternalStore(
		subscribe,
		() => getSeferPasukSelection(perekId),
		() => EMPTY,
	);
}

/** React binding for the perek's pasuk-selection mode flag. */
export function useSeferPasukSelectionMode(perekId: number): boolean {
	return useSyncExternalStore(
		subscribe,
		() => isSeferPasukSelectionMode(perekId),
		() => false,
	);
}
