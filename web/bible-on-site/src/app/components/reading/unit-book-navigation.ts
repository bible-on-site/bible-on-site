import type { UnitBookScope } from "./unit-book-content";

/**
 * Bidirectional pasuk navigation inside an alternative-division sefer
 * book (issue #2191) — the unit counterpart of the perek reader's
 * sefer-pasuk-navigation.
 *
 * When a perush is open on a unit's blank page, pasuk-number clicks
 * jump between the facing pages: a click in the unit text scrolls the
 * open perush panel to the start of that pasuk's commentary group, and
 * a click on a pasuk label inside the perush scrolls the unit text to
 * the matching pasuk.
 *
 * Every pane is keyed by a `bookKey` (`{unitId}:{scope}`) rather than a
 * perek id: a parasha carries separate Torah and Haftarah panes, and a
 * Masoretic boundary pasuk may appear in two adjacent units' texts —
 * the bookKey scopes each lookup to the facing pair. Inside the pane,
 * the full {perekId, pasuk} identity keeps identical pasuk numbers in
 * different perakim from colliding (cross-perek parashot).
 */

/** Marker on a unit text page in the book, keyed by bookKey. */
const UNIT_TEXT_ATTR = "data-sefer-unit-text";
/** Marker on the root of a mounted open perush panel, keyed by bookKey. */
const UNIT_PERUSH_ATTR = "data-sefer-unit-perush";
/** Marker on a pasuk commentary group inside the open perush. */
const UNIT_PERUSH_PASUK_ATTR = "data-unit-perush-pasuk";
/** Marker on the clickable pasuk numeral inside the unit text. */
export const UNIT_PASUK_NUM_ATTR = "data-pasuk-num";
/** Highlight marker applied to the navigation destination element. */
const PASUK_HIGHLIGHT_ATTR = "data-pasuk-highlight";

/** The facing-page pair key for a unit's Torah or Haftarah spread. */
export function unitBookKey(unitId: number, scope: UnitBookScope): string {
	return `${unitId}:${scope}`;
}

/** Root of the open perush panel for a bookKey, or null when unmounted. */
export function findOpenUnitPerushPanel(
	bookKey: string,
	root: ParentNode = document,
): Element | null {
	return root.querySelector(`[${UNIT_PERUSH_ATTR}="${bookKey}"]`);
}

/** Start of a pasuk's commentary group inside the pane's open perush. */
export function findUnitPerushPasukGroup(
	bookKey: string,
	perekId: number,
	pasuk: number,
	root: ParentNode = document,
): Element | null {
	return (
		findOpenUnitPerushPanel(bookKey, root)?.querySelector(
			`[${UNIT_PERUSH_PASUK_ATTR}="${perekId}-${pasuk}"]`,
		) ?? null
	);
}

/** Pasuk anchor inside the pane's book text page. Canonical anchors
 * (`pasuk-{perekId}-{pasuk}`) are tried first, then scope-suffixed
 * auxiliary anchors (`pasuk-{perekId}-{pasuk}-{scope}`) so a Haftarah
 * variant's pesukim resolve too. */
export function findUnitTextPasuk(
	bookKey: string,
	perekId: number,
	pasuk: number,
	root: ParentNode = document,
): Element | null {
	const page = root.querySelector(`[${UNIT_TEXT_ATTR}="${bookKey}"]`);
	if (!page) return null;
	return (
		page.querySelector(`[id="pasuk-${perekId}-${pasuk}"]`) ??
		page.querySelector(`[id^="pasuk-${perekId}-${pasuk}-"]`)
	);
}

/** Marks the destination and clears the previous marker within its pane. */
function movePasukHighlight(scope: Element, target: Element): void {
	for (const el of scope.querySelectorAll(`[${PASUK_HIGHLIGHT_ATTR}]`)) {
		el.removeAttribute(PASUK_HIGHLIGHT_ATTR);
		el.removeAttribute("aria-current");
	}
	target.setAttribute(PASUK_HIGHLIGHT_ATTR, "");
	target.setAttribute("aria-current", "location");
}

/**
 * Scrolls the pane's open perush to the start of a pasuk's commentary
 * group and highlights it. Returns false when no perush is open for the
 * pane or the perush has no note on the pasuk — the caller then keeps
 * the panel and reading state untouched.
 */
export function scrollToUnitPerushPasuk(
	bookKey: string,
	perekId: number,
	pasuk: number,
	root: ParentNode = document,
): boolean {
	const panel = findOpenUnitPerushPanel(bookKey, root);
	const target = findUnitPerushPasukGroup(bookKey, perekId, pasuk, root);
	if (!panel || !target) return false;
	movePasukHighlight(panel, target);
	target.scrollIntoView({ behavior: "instant", block: "start" });
	return true;
}

/**
 * Scrolls the pane's book text page to a pasuk and highlights it.
 * Returns false when the page or the pasuk is not mounted.
 */
export function scrollToUnitTextPasuk(
	bookKey: string,
	perekId: number,
	pasuk: number,
	root: ParentNode = document,
): boolean {
	const page = root.querySelector(`[${UNIT_TEXT_ATTR}="${bookKey}"]`);
	const target = findUnitTextPasuk(bookKey, perekId, pasuk, root);
	if (!page || !target) return false;
	movePasukHighlight(page, target);
	target.scrollIntoView({ behavior: "instant", block: "start" });
	return true;
}

/** The perush open on a pane's blank page, as seen by the facing text. */
export interface UnitOpenPerush {
	/** Perush name (its slug in the perushim carousel). */
	name: string;
	/**
	 * Canonical `{perekId}-{pasuk}` keys carrying at least one note in
	 * this perush inside the unit's bounds. Pesukim outside the set keep
	 * their plain behaviour instead of offering a navigation that could
	 * never resolve.
	 */
	pesukim: ReadonlySet<string>;
}

/**
 * Tracks which perush panel is open per book pane so unit text offers
 * pasuk-number navigation only while a perush is actually open. Kept
 * outside React so publishing never re-renders book pages; the text
 * page's delegated click consults it at click time.
 */
const openPerushByPane = new Map<string, UnitOpenPerush>();

/** Publishes the perush open on a pane's blank page (null when closed). */
export function setUnitOpenPerush(
	bookKey: string,
	perush: UnitOpenPerush | null,
): void {
	if (perush == null) openPerushByPane.delete(bookKey);
	else openPerushByPane.set(bookKey, perush);
}

/** The perush currently open for a book pane, or null. */
export function getUnitOpenPerush(bookKey: string): UnitOpenPerush | null {
	return openPerushByPane.get(bookKey) ?? null;
}

/**
 * Delegated pasuk-numeral click on a unit text page: resolves the
 * numeral's canonical `{perekId, pasuk}` from its anchor id and scrolls
 * the facing open perush to that pasuk's group. No-ops when the click
 * is not on a numeral, when no perush is open for the pane, or when the
 * pasuk carries no note — keeping the page's other click targets
 * (Tanahpedia links, flip gestures) untouched.
 */
export function handleUnitTextPasukClick(
	bookKey: string,
	target: EventTarget | null,
): void {
	const el = target as HTMLElement | null;
	const numEl = el?.closest?.(`[${UNIT_PASUK_NUM_ATTR}]`);
	const anchor = numEl?.closest('[id^="pasuk-"]');
	const match = anchor?.id.match(/^pasuk-(\d+)-(\d+)/);
	if (!match) return;
	const perekId = Number.parseInt(match[1], 10);
	const pasuk = Number.parseInt(match[2], 10);
	if (!getUnitOpenPerush(bookKey)?.pesukim.has(`${perekId}-${pasuk}`)) {
		return;
	}
	scrollToUnitPerushPasuk(bookKey, perekId, pasuk);
}
