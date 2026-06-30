/**
 * Persist perek page view (SEO vs תצוגת ספר) in localStorage (#1322).
 */

export const PEREK_VIEW_MODE_STORAGE_KEY = "perekViewMode" as const;

export type PerekViewMode = "book" | "seo";

export function getStoredPerekViewMode(): PerekViewMode | null {
	/* istanbul ignore next: SSR */
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(PEREK_VIEW_MODE_STORAGE_KEY);
		if (raw === "book" || raw === "seo") return raw;
		return null;
	} catch {
		return null;
	}
}

export function setStoredPerekViewMode(mode: PerekViewMode): void {
	try {
		localStorage.setItem(PEREK_VIEW_MODE_STORAGE_KEY, mode);
	} catch {
		/* quota / private mode */
	}
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
	}
	const q = params.toString();
	return q.length > 0 ? `${pathname}?${q}` : pathname;
}
