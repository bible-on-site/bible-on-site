/**
 * URL contract for the in-place perush view on alternative-division
 * unit pages (issue #2190). A selected perush is a query param on the
 * unit's own URL — the reader never navigates to /929 — so the open
 * commentary keeps the selected parasha, the reader mode (`?book`
 * params survive), and the page's scroll position. Sections carry
 * separate params so a Torah scope and a Haftarah scope stay
 * independent.
 */

/** Commentary scopes inside a reading unit. */
export type UnitPerushScope = "torah" | "haftara";

export const UNIT_PERUSH_PARAM = "perush";
export const UNIT_HAFTARA_PERUSH_PARAM = "haftaraPerush";

/** The query param carrying the selected perush name for a scope. */
export function perushParamName(scope: UnitPerushScope): string {
	return scope === "haftara" ? UNIT_HAFTARA_PERUSH_PARAM : UNIT_PERUSH_PARAM;
}

/**
 * Deep link opening a perush inside a unit page: the unit's own path
 * plus the scope's perush param. Existing query params (reader mode,
 * book page, other scope's perush) are preserved when `search` is
 * supplied.
 */
export function unitPerushHref(
	unitPath: string,
	scope: UnitPerushScope,
	perushName: string,
	search = "",
): string {
	const params = new URLSearchParams(
		search.startsWith("?") ? search.slice(1) : search,
	);
	params.set(perushParamName(scope), perushName);
	return `${unitPath}?${params.toString()}`;
}

/** The unit path without the scope's perush param — the "back" link. */
export function unitPathWithoutPerush(
	unitPath: string,
	scope: UnitPerushScope,
	search = "",
): string {
	const params = new URLSearchParams(
		search.startsWith("?") ? search.slice(1) : search,
	);
	params.delete(perushParamName(scope));
	const query = params.toString();
	return query ? `${unitPath}?${query}` : unitPath;
}
