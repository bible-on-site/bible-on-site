import { createElement, type ReactNode } from "react";

/**
 * Pure helpers for the TanahpediaEntryPreview popover (#3712): which anchors
 * carry an entity preview, which entry a preview href names, and where the
 * popover lands next to its anchor. Kept DOM-light and injectable so the
 * positioning math and event matching are unit-testable without mounting
 * the component.
 */

/**
 * Entity links worth a preview in every render path. React-rendered
 * `TanahpediaLink` anchors mark themselves with `data-tanahpedia-entry`
 * (their `.tanahpediaLink` class is CSS-module hashed and cannot be matched
 * here), while pipeline-injected anchors inside stored article HTML carry
 * the global `tanahpedia-mention` class (see decorate-article-html.ts).
 */
export const ENTITY_PREVIEW_LINK_SELECTOR =
	"a.tanahpedia-mention, a[data-tanahpedia-entry]";

/** The entity anchor an event target belongs to, if any. */
export function entityPreviewLink(
	target: EventTarget | null,
): HTMLAnchorElement | null {
	if (!(target instanceof Element)) return null;
	// The selector only matches `a` elements, so closest() yields anchors.
	return target.closest(
		ENTITY_PREVIEW_LINK_SELECTOR,
	) as HTMLAnchorElement | null;
}

/** The unique entry name a `/pedia/<name>` href points at, else null. */
export function previewUniqueNameFromHref(href: string): string | null {
	let pathname: string;
	try {
		pathname = new URL(href, "http://localhost").pathname;
	} catch (error) {
		console.warn("Tanahpedia preview: unparseable href", { href, error });
		return null;
	}
	const match = /^\/pedia\/([^/]+)\/?$/.exec(pathname);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch (error) {
		console.warn("Tanahpedia preview: malformed escape in href", {
			href,
			error,
		});
		return null;
	}
}

/**
 * Hover-capable fine pointers get the preview; on touch-primary devices the
 * tap keeps navigating with nothing in the way.
 */
export function entityPreviewPointerEnabled(win: {
	matchMedia: (query: string) => { matches: boolean };
}): boolean {
	return win.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/** Element tags the preview API's allowlist can emit (see toPreviewHtml). */
const SNIPPET_ELEMENT_TAGS = new Set(["h2", "h3", "h4", "br"]);

/**
 * Server-sanitized preview markup → React children, without
 * `dangerouslySetInnerHTML`. The API allowlist only emits h2-h4, br and
 * text; the client re-walks the parsed tree through that same whitelist so
 * unexpected markup degrades to plain text and entities decode safely.
 */
export function previewSnippetChildren(snippet: string): ReactNode[] {
	const doc = new DOMParser().parseFromString(snippet, "text/html");
	return Array.from(doc.body.childNodes).map(snippetNodeToElement);
}

function snippetNodeToElement(node: ChildNode, index: number): ReactNode {
	if (node.nodeType === Node.TEXT_NODE) return node.textContent;
	if (node.nodeType !== Node.ELEMENT_NODE) return null;
	const element = node as Element;
	const children = Array.from(element.childNodes).map(snippetNodeToElement);
	const tag = element.tagName.toLowerCase();
	if (!SNIPPET_ELEMENT_TAGS.has(tag)) return element.textContent;
	return createElement(tag, { key: index }, ...children);
}

/**
 * Overflow values whose box clips descendants. A focused anchor scrolled
 * out of such a container keeps keyboard focus while the link itself is
 * invisible - its preview must hide rather than float over header controls.
 */
const CLIPPING_OVERFLOW = /auto|scroll|hidden|clip/;

/**
 * True while the anchor is fully clipped away by a scrolling ancestor: its
 * rect intersected with every clipping ancestor's box leaves no visible
 * area. A viewport-clip alone is not checked - an off-viewport anchor also
 * positions its popover off-viewport, which is already invisible.
 */
export function anchorFullyClipped(anchor: Element): boolean {
	const { top, bottom, left, right } = anchor.getBoundingClientRect();
	const visible = { top, bottom, left, right };
	for (
		let clipper = anchor.parentElement;
		clipper;
		clipper = clipper.parentElement
	) {
		const style = getComputedStyle(clipper);
		const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
		if (!CLIPPING_OVERFLOW.test(overflow)) continue;
		const clip = clipper.getBoundingClientRect();
		visible.top = Math.max(visible.top, clip.top);
		visible.bottom = Math.min(visible.bottom, clip.bottom);
		visible.left = Math.max(visible.left, clip.left);
		visible.right = Math.min(visible.right, clip.right);
		if (visible.bottom <= visible.top || visible.right <= visible.left) {
			return true;
		}
	}
	return false;
}

export interface PreviewPosition {
	x: number;
	y: number;
}

/**
 * Fixed-position top-left for the popover near its anchor: below the anchor
 * when it fits, above when not (or on the roomier side when neither fully
 * fits, clamped into the viewport). The popover is horizontally centered on
 * the anchor, so the same math is correct under RTL and LTR text direction.
 */
export function computePreviewPosition(
	anchor: { top: number; bottom: number; left: number; width: number },
	popover: { width: number; height: number },
	viewport: { width: number; height: number },
	{ gap = 10, margin = 8 }: { gap?: number; margin?: number } = {},
): PreviewPosition {
	const centeredX = anchor.left + anchor.width / 2 - popover.width / 2;
	const maxX = Math.max(margin, viewport.width - margin - popover.width);
	const x = Math.min(Math.max(centeredX, margin), maxX);

	const belowY = anchor.bottom + gap;
	const aboveY = anchor.top - gap - popover.height;
	const fitsBelow = belowY + popover.height <= viewport.height - margin;
	const fitsAbove = aboveY >= margin;
	let y: number;
	if (fitsBelow) {
		y = belowY;
	} else if (fitsAbove) {
		y = aboveY;
	} else {
		const belowSpace = viewport.height - margin - belowY;
		const aboveSpace = anchor.top - gap - margin;
		y = belowSpace >= aboveSpace ? belowY : aboveY;
		const maxY = Math.max(margin, viewport.height - margin - popover.height);
		y = Math.min(Math.max(y, margin), maxY);
	}
	return { x, y };
}
