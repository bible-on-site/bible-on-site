/**
 * URL contract for commentary and article deep links inside an
 * alternative-division sefer book (issue #2191).
 *
 * The params share the unit reader's scope names — `perush` and
 * `haftaraPerush` are the same selections the flat unit pages use for
 * in-place commentary (issue #2190), so a perush selection survives
 * the flat<->book mode toggle: `?perush=` opens the same perush on
 * the flat unit page and on its `?book` blank page. `article` and
 * `haftaraArticle` are book-side selections only: flat unit pages keep
 * opening articles on their canonical /929 routes, so an article
 * param rides the flat URL untouched (the toggle preserves it) and
 * regains its selection when the reader returns to the book.
 *
 * Every content route also names its book spread — Torah content rides
 * on `/יחידה?book`, Haftarah content on `/יחידה?book&haftara` — so the
 * history mapping lands on the spread whose blank page hosts the open
 * content, never on a conventional perek address.
 */
export type UnitBookScope = "torah" | "haftara";
export type UnitBookContentKind = "perush" | "article";

/** Selected in-book content parsed from a book route. */
export interface UnitBookContent {
	unitId: number;
	/** Whether the route names the Haftarah spread. */
	haftara: boolean;
	perush?: string;
	article?: string;
	haftaraPerush?: string;
	haftaraArticle?: string;
}

/** Query param carrying one scope's perush/article selection. */
export function unitBookContentParam(
	scope: UnitBookScope,
	kind: UnitBookContentKind,
): string {
	if (kind === "perush") {
		return scope === "haftara" ? "haftaraPerush" : "perush";
	}
	return scope === "haftara" ? "haftaraArticle" : "article";
}

/** The blank page's restore slug for a scope (perush selection wins). */
export function unitBookContentSlug(
	content: UnitBookContent | null,
	unitId: number,
	scope: UnitBookScope,
): string | undefined {
	if (!content || content.unitId !== unitId) return undefined;
	return scope === "haftara"
		? (content.haftaraPerush ?? content.haftaraArticle)
		: (content.perush ?? content.article);
}

/**
 * Parses the selected in-book content from a book route. Both the
 * public Hebrew root ("/מסורה", "/פרשה") and its ASCII route dir
 * ("/masora", "/parasha") are accepted so popstate and internal routes
 * resolve identically. The default unit segment is the decimal unitId;
 * divisions with named public slugs pass `unitIdFor` (issue #2738).
 */
export function unitBookContentFromRoute(
	route: string,
	rootPaths: string | readonly string[],
	unitIdFor?: (segment: string) => number | null,
): UnitBookContent | null {
	const [pathname, query = ""] = route.split("?");
	const params = new URLSearchParams(query);
	if (!params.has("book")) return null;
	const decoded = decodeURIComponent(pathname);
	const roots = Array.isArray(rootPaths) ? rootPaths : [rootPaths];
	const root = roots.find(
		(candidate) =>
			decoded.startsWith(`${candidate}/`) || decoded === candidate,
	);
	if (!root || decoded === root) return null;
	const segment = decoded.slice(root.length + 1).split("/")[0];
	const unitId = unitIdFor ? unitIdFor(segment) : Number.parseInt(segment, 10);
	if (unitId === null || !Number.isInteger(unitId) || unitId < 1) return null;
	return {
		unitId,
		haftara: params.has("haftara"),
		perush: params.get("perush") ?? undefined,
		article: params.get("article") ?? undefined,
		haftaraPerush: params.get("haftaraPerush") ?? undefined,
		haftaraArticle: params.get("haftaraArticle") ?? undefined,
	};
}

/**
 * Href for a unit's book content deep link — used as the modifier-key /
 * new-tab target of carousel items inside the book so opening the same
 * perush or article in another tab lands inside the book, not on /929.
 */
export function unitBookContentHref(
	unitPath: string,
	scope: UnitBookScope,
	kind: UnitBookContentKind,
	slug: string,
): string {
	const params = new URLSearchParams();
	params.set("book", "");
	if (scope === "haftara") params.set("haftara", "");
	params.set(unitBookContentParam(scope, kind), slug);
	return `${unitPath}?${params.toString()}`;
}

/**
 * History write for an in-book content selection, mirroring the perek
 * reader's writeSeferContentHistory: the router's state and the
 * flipbook's ownership marker are preserved so the book restores the
 * entry itself without a router navigation. The route names the
 * scope's spread (`&haftara` for Haftarah content) and keeps the other
 * scope's selection params untouched; clearing a scope drops only its
 * own params.
 */
export function writeUnitBookContentHistory(
	rootPath: string,
	unitSegment: string | number,
	scope: UnitBookScope,
	kind?: UnitBookContentKind,
	slug?: string,
	replace = false,
): string {
	const params = new URLSearchParams(window.location.search);
	params.set("book", "");
	if (scope === "haftara") params.set("haftara", "");
	else params.delete("haftara");
	params.delete(unitBookContentParam(scope, "perush"));
	params.delete(unitBookContentParam(scope, "article"));
	if (kind && slug) params.set(unitBookContentParam(scope, kind), slug);
	const route = `${rootPath}/${unitSegment}?${params.toString()}`;
	const state = { ...history.state, route };
	const method = replace
		? History.prototype.replaceState
		: History.prototype.pushState;
	method.call(history, state, "", route);
	return route;
}
