/**
 * Persist the learning calendar's flipping-book presentation preference in
 * localStorage (#2993), mirroring the perek reader's book/seo preference:
 * the choice survives reloads, while an explicit `?flip=1` query param still
 * wins for shared links.
 */

export const CALENDAR_FLIP_VIEW_STORAGE_KEY = "calendarFlipView" as const;

export type CalendarFlipView = "flip" | "overview";

export function getStoredCalendarFlipView(): CalendarFlipView | null {
	/* istanbul ignore next: SSR */
	if (typeof window === "undefined") {
		return null;
	}
	try {
		const raw = localStorage.getItem(CALENDAR_FLIP_VIEW_STORAGE_KEY);
		return raw === "flip" || raw === "overview" ? raw : null;
	} catch (error) {
		// Storage can be denied (private mode, policy); the preference is
		// optional so falling back to the default is nonfatal — still logged.
		console.warn("Failed to read the calendar presentation preference", error);
		return null;
	}
}

export function setStoredCalendarFlipView(view: CalendarFlipView): void {
	try {
		localStorage.setItem(CALENDAR_FLIP_VIEW_STORAGE_KEY, view);
	} catch (error) {
		// Quota / private mode: the session preference still applies in
		// memory; the failure stays diagnosable instead of silent.
		console.warn("Failed to persist the calendar presentation preference", error);
	}
}
