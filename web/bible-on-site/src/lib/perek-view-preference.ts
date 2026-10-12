/**
 * Persist perek page view (SEO vs תצוגת ספר) in localStorage (#1322).
 */

export const PEREK_VIEW_MODE_STORAGE_KEY = "perekViewMode" as const;
/** Separate key for the פרשה reader — its book preference is its own section's choice, not the /929 division's. */
export const PARASHA_VIEW_MODE_STORAGE_KEY = "parashaViewMode" as const;

export type PerekViewMode = "book" | "seo";

function getStoredViewMode(storageKey: string): PerekViewMode | null {
	/* istanbul ignore next: SSR */
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(storageKey);
		if (raw === "book" || raw === "seo") return raw;
		return null;
	} catch {
		return null;
	}
}

function setStoredViewMode(storageKey: string, mode: PerekViewMode): void {
	try {
		localStorage.setItem(storageKey, mode);
	} catch {
		/* quota / private mode */
	}
}

export function getStoredPerekViewMode(): PerekViewMode | null {
	return getStoredViewMode(PEREK_VIEW_MODE_STORAGE_KEY);
}

export function setStoredPerekViewMode(mode: PerekViewMode): void {
	setStoredViewMode(PEREK_VIEW_MODE_STORAGE_KEY, mode);
}

export function getStoredParashaViewMode(): PerekViewMode | null {
	return getStoredViewMode(PARASHA_VIEW_MODE_STORAGE_KEY);
}

export function setStoredParashaViewMode(mode: PerekViewMode): void {
	setStoredViewMode(PARASHA_VIEW_MODE_STORAGE_KEY, mode);
}

/**
 * Merge `?book` into the current query string; preserves other params.
 */
export function pathnameWithBookQuery(
	pathname: string,
	currentSearch: string,
	wantBook: boolean,
): string {
	const params = new URLSearchParams(
		currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch,
	);
	if (wantBook) {
		params.set("book", "");
	} else {
		params.delete("book");
		params.delete("toc");
		params.delete("bookPage");
	}
	const q = params.toString();
	return q.length > 0 ? `${pathname}?${q}` : pathname;
}
