import { useSyncExternalStore } from "react";

/**
 * Bidirectional pasuk navigation inside the Sefer (flipbook) view.
 *
 * When a perush is open on a perek's blank page, pasuk-number clicks jump
 * between the facing pages: a click in the perek text scrolls the open perush
 * panel to the start of that pasuk's commentary group, and a click on a pasuk
 * label inside the perush scrolls the perek text to the matching pasuk.
 *
 * The flipbook keeps neighbouring perakim mounted in the DOM, so every target
 * is resolved by the complete perek + pasuk identity — identical pasuk
 * numbers in other perakim never match.
 */

/** Marker on the root of the mounted open perush panel, keyed by perek id. */
const OPEN_PERUSH_ATTR = "data-sefer-perush-perek";
/** Marker on a perek text page in the book, keyed by perek id. */
const SEFER_PEREK_ATTR = "data-sefer-perek";
/** Marker on a pasuk inside the perek text page. */
const SEFER_PASUK_ATTR = "data-sefer-pasuk";
/** Marker on a pasuk commentary group inside the open perush. */
const PERUSH_PASUK_ATTR = "data-perush-pasuk";
/** Highlight marker applied to the navigation destination element. */
const PASUK_HIGHLIGHT_ATTR = "data-pasuk-highlight";

/** Root of the open perush panel for a perek, or null when none is mounted. */
export function findOpenPerushPanel(
	perekId: number,
	root: ParentNode = document,
): Element | null {
	return root.querySelector(`[${OPEN_PERUSH_ATTR}="${perekId}"]`);
}

/** Start of a pasuk's commentary group inside the perek's open perush. */
export function findPerushPasukGroup(
	perekId: number,
	pasuk: number,
	root: ParentNode = document,
): Element | null {
	return (
		findOpenPerushPanel(perekId, root)?.querySelector(
			`[${PERUSH_PASUK_ATTR}="${pasuk}"]`,
		) ?? null
	);
}

/** Pasuk element inside the perek's book text page. */
export function findSeferPasuk(
	perekId: number,
	pasuk: number,
	root: ParentNode = document,
): Element | null {
	return (
		root
			.querySelector(`[${SEFER_PEREK_ATTR}="${perekId}"]`)
			?.querySelector(`[${SEFER_PASUK_ATTR}="${pasuk}"]`) ?? null
	);
}

const highlightCleanup = new WeakMap<Element, () => void>();

/** Marks the destination, then fades after four seconds or clears on click. */
function movePasukHighlight(scope: Element, target: Element): void {
	for (const el of scope.querySelectorAll(`[${PASUK_HIGHLIGHT_ATTR}]`)) {
		const clear = highlightCleanup.get(el);
		if (clear) clear();
		else {
			el.removeAttribute(PASUK_HIGHLIGHT_ATTR);
			el.removeAttribute("aria-current");
		}
	}
	target.setAttribute(PASUK_HIGHLIGHT_ATTR, "");
	target.setAttribute("aria-current", "location");
	let fadeTimer: ReturnType<typeof setTimeout>;
	const clear = () => {
		clearTimeout(holdTimer);
		clearTimeout(fadeTimer);
		target.removeAttribute(PASUK_HIGHLIGHT_ATTR);
		target.removeAttribute("aria-current");
		target.removeEventListener("click", clear);
		highlightCleanup.delete(target);
	};
	const holdTimer = setTimeout(() => {
		target.setAttribute(PASUK_HIGHLIGHT_ATTR, "fading");
		fadeTimer = setTimeout(clear, 600);
	}, 4000);
	highlightCleanup.set(target, clear);
	target.addEventListener("click", clear, { once: true });
}

/**
 * Scrolls the perek's open perush to the start of a pasuk's commentary group
 * and highlights it. Returns false when no perush is open for the perek or
 * the perush has no note on the pasuk — the caller then keeps the panel and
 * reading state untouched.
 */
export function scrollToPerushPasuk(
	perekId: number,
	pasuk: number,
	root: ParentNode = document,
): boolean {
	const panel = findOpenPerushPanel(perekId, root);
	const target = findPerushPasukGroup(perekId, pasuk, root);
	if (!panel || !target) return false;
	movePasukHighlight(panel, target);
	target.scrollIntoView({ behavior: "instant", block: "start" });
	return true;
}

/**
 * Scrolls the perek's book text page to a pasuk and highlights it. Returns
 * false when the perek page or the pasuk is not mounted.
 */
export function scrollToSeferPasuk(
	perekId: number,
	pasuk: number,
	root: ParentNode = document,
): boolean {
	const page = root.querySelector(`[${SEFER_PEREK_ATTR}="${perekId}"]`);
	const target = findSeferPasuk(perekId, pasuk, root);
	if (!page || !target) return false;
	movePasukHighlight(page, target);
	target.scrollIntoView({ behavior: "instant", block: "start" });
	return true;
}

/** The perush open on a perek's blank page, as seen by the facing text. */
export interface SeferOpenPerush {
	/** Perush name (its slug in the perushim carousel). */
	name: string;
	/**
	 * Pasuk numbers that have at least one note in this perush on this perek.
	 * Pasuk numbers outside the set keep their recitation behaviour instead
	 * of offering a navigation that could never resolve.
	 */
	pesukim: ReadonlySet<number>;
}

/**
 * Tracks which perush panel is open per perek so perek text offers
 * pasuk-number navigation only while a perush is actually open. Kept outside
 * React so publishing never re-renders book pages; per-pasuk consumers
 * subscribe via useSyncExternalStore and re-render only their own control.
 */
const openPerushByPerek = new Map<number, SeferOpenPerush>();
const openPerushListeners = new Set<() => void>();

function samePasukSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
	return a.size === b.size && [...a].every((pasuk) => b.has(pasuk));
}

/** Publishes the perush open on a perek's blank page (null when closed). */
export function setSeferOpenPerush(
	perekId: number,
	perush: SeferOpenPerush | null,
): void {
	const existing = openPerushByPerek.get(perekId) ?? null;
	// Same commentary republished (or still closed): keep the stored entry so
	// subscribed snapshots stay referentially stable and nothing re-renders.
	// The pesukim set participates too — the commentary panel can republish
	// under the same label with a different coverage set (#2544).
	if (
		existing?.name === perush?.name &&
		(existing == null ||
			perush == null ||
			samePasukSet(existing.pesukim, perush.pesukim))
	)
		return;
	if (perush == null) openPerushByPerek.delete(perekId);
	else openPerushByPerek.set(perekId, perush);
	for (const listener of openPerushListeners) listener();
}

/** The perush currently open for a perek, or null. */
export function getSeferOpenPerush(perekId: number): SeferOpenPerush | null {
	return openPerushByPerek.get(perekId) ?? null;
}

function subscribeOpenPerush(listener: () => void): () => void {
	openPerushListeners.add(listener);
	return () => {
		openPerushListeners.delete(listener);
	};
}

/** React binding for the perush currently open for a perek, or null. */
export function useSeferOpenPerush(perekId: number): SeferOpenPerush | null {
	return useSyncExternalStore(
		subscribeOpenPerush,
		() => getSeferOpenPerush(perekId),
		() => null,
	);
}
