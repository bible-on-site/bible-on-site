import { hebrewNumeral } from "./adminHebrew";
import DOMPurify from "dompurify";

/**
 * Legacy tanahpedia footnotes were hand-built HTML:
 *   ref   `<sup><a href="#note-1" id="noteref-1">א</a></sup>`
 *   body  `<p id="note-1"><strong>א.</strong> טקסט</p>`
 *
 * `tiptap-footnotes` owns numbering and ordering instead, and expects:
 *   ref   `<sup id="fnref:1"><a class="footnote-ref" data-id="…" data-reference-number="1" href="#fn:1">א</a></sup>`
 *   body  `<ol class="footnotes"><li id="fn:1" data-id="…"><p>טקסט</p></li></ol>`
 *
 * The conversion runs when content is loaded into the editor, so entries
 * migrate the first time they are saved — no bulk data migration needed.
 */

const LEGACY_MARKER =
	/id=["']note(?:ref)?-\d+["']|href=["']#note-\d+["']/i;
const LEGACY_BODY_ID = /^note-(\d+)$/;
const LEGACY_REF_HREF = /^#note-(\d+)$/;
/** `א.` / `יא.` — the visible marker that used to be baked into the body. */
const LEGACY_BODY_MARKER = /^[\u05D0-\u05EA]{1,3}\.?$/;
/** Heading that introduced the hand-made footnote section. */
const LEGACY_SECTION_TITLE = /^\s*הערות\s*$/;
const REFNUM_ATTR_NAME = "data-reference-number";

export function hasLegacyFootnotes(html: string): boolean {
	return LEGACY_MARKER.test(html);
}

let fallbackIdCounter = 0;

function newFootnoteId(): string {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}
	fallbackIdCounter += 1;
	return `fn-${Date.now().toString(36)}-${fallbackIdCounter}`;
}

function isBlank(text: string | null): boolean {
	return !text?.replace(/\u00a0/g, " ").trim();
}

function isLegacyBodyMarker(node: ChildNode): boolean {
	if (node.nodeType !== Node.ELEMENT_NODE) return false;
	const element = node as Element;
	/* The importer wrote the marker as `<strong>א.</strong>` or `<sup>א</sup>`. */
	return (
		(element.tagName === "STRONG" || element.tagName === "SUP") &&
		LEGACY_BODY_MARKER.test((element.textContent ?? "").trim())
	);
}

/** Moves the body's content into `target`, dropping the old `א.` prefix. */
function moveBodyContent(
	target: Element,
	body: Element,
	marker: string,
): void {
	/* `<a href="#noteref-1">↩</a>` was the manual jump-back link; the extension
	   renders its own navigation, so the leftover arrow would be noise. */
	for (const backLink of Array.from(
		body.querySelectorAll('a[href^="#noteref-"]'),
	)) {
		backLink.remove();
	}

	/* Re-saved entries wrap the text in a paragraph; keep one level of `<p>`. */
	const source =
		body.childElementCount === 1 &&
		body.firstElementChild?.tagName === "P" &&
		isBlank(body.textContent) === isBlank(body.firstElementChild.textContent)
			? body.firstElementChild
			: body;

	let atStart = true;
	for (const node of Array.from(source.childNodes)) {
		if (atStart) {
			if (isLegacyBodyMarker(node)) continue;
			if (node.nodeType === Node.TEXT_NODE && isBlank(node.textContent)) {
				continue;
			}
			atStart = false;
			if (node.nodeType === Node.TEXT_NODE) {
				node.textContent = stripLeadingMarker(node.textContent ?? "", marker);
			}
		}
		target.appendChild(node);
	}

	while (
		target.lastChild &&
		target.lastChild.nodeType === Node.TEXT_NODE &&
		isBlank(target.lastChild.textContent)
	) {
		target.lastChild.remove();
	}
	/* The removed back-link usually leaves a dangling space before the marker. */
	if (target.lastChild?.nodeType === Node.TEXT_NODE) {
		target.lastChild.textContent = (
			target.lastChild.textContent ?? ""
		).replace(/[\s\u00a0]+$/, "");
	}
}

/**
 * Once a body loses its `<sup>` wrapper the marker survives as plain text
 * (`מט ריש לקיש…`). Only an exact match of the expected numeral is removed,
 * so real text that happens to start with a Hebrew word is left alone.
 */
function stripLeadingMarker(text: string, marker: string): string {
	const trimmed = text.replace(/^[\s\u00a0]+/, "");
	/* The marker must be a standalone token, otherwise `\u05d1` would eat the first
	   letter of a body that legitimately starts with `\u05d1\u05e8\u05d0\u05e9\u05d9\u05ea`. */
	const rest = trimmed.slice(marker.length);
	if (!trimmed.startsWith(marker) || !/^\.?[\s\u00a0]/.test(rest)) {
		return trimmed;
	}
	return rest.replace(/^\.?[\s\u00a0]+/, "");
}

/**
 * Drops the hand-made "הערות" section once its items moved into the extension's
 * list: the emptied `<ol>` plus the `<hr>` / heading that introduced it.
 */
function removeLegacySection(container: Element | null): void {
	if (!container || container.childElementCount > 0) return;
	let sibling = container.previousSibling;
	container.remove();

	while (sibling) {
		const previous = sibling.previousSibling;
		if (sibling.nodeType === Node.TEXT_NODE && isBlank(sibling.textContent)) {
			sibling.remove();
		} else if (sibling.nodeType === Node.ELEMENT_NODE) {
			const element = sibling as Element;
			const isHeading = /^H[1-6]$/.test(element.tagName);
			if (isHeading && LEGACY_SECTION_TITLE.test(element.textContent ?? "")) {
				element.remove();
			} else if (element.tagName === "HR") {
				element.remove();
				return;
			} else {
				return;
			}
		} else {
			return;
		}
		sibling = previous;
	}
}

function buildReference(doc: Document, num: number, id: string): HTMLElement {
	const sup = doc.createElement("sup");
	sup.id = `fnref:${num}`;
	const link = doc.createElement("a");
	link.className = "footnote-ref";
	link.setAttribute("data-id", id);
	link.setAttribute(REFNUM_ATTR_NAME, String(num));
	link.setAttribute("href", `#fn:${num}`);
	link.setAttribute("role", "doc-noteref");
	link.textContent = hebrewNumeral(num);
	sup.appendChild(link);
	return sup;
}

export function migrateLegacyFootnotes(html: string): string {
	if (!hasLegacyFootnotes(html)) return html;

	const doc = new DOMParser().parseFromString(
		`<div data-migration-root="1">${html}</div>`,
		"text/html",
	);
	const root = doc.querySelector("[data-migration-root]");
	if (!root) return html;

	const anchors = Array.from(root.querySelectorAll("a[href]")).filter((a) =>
		LEGACY_REF_HREF.test(a.getAttribute("href") ?? ""),
	);
	/* Bodies without references stay as plain paragraphs — nothing to link them to. */
	if (anchors.length === 0) return html;

	const bodies = new Map<number, Element>();
	for (const el of Array.from(root.querySelectorAll("[id]"))) {
		const match = LEGACY_BODY_ID.exec(el.id);
		if (match && !bodies.has(Number(match[1]))) {
			bodies.set(Number(match[1]), el);
		}
	}
	/* Entries re-saved by the previous editor lost the `id="note-N"` anchor, so
	   the jump-back link is the only thing tying a body to its reference. */
	for (const backLink of Array.from(
		root.querySelectorAll('a[href^="#noteref-"]'),
	)) {
		const num = Number(
			/^#noteref-(\d+)$/.exec(backLink.getAttribute("href") ?? "")?.[1],
		);
		const body = backLink.closest("li") ?? backLink.closest("p");
		if (Number.isFinite(num) && body && !bodies.has(num)) {
			bodies.set(num, body);
		}
	}

	const items = anchors.map((anchor, index) => {
		const legacyNum = Number(
			LEGACY_REF_HREF.exec(anchor.getAttribute("href") ?? "")?.[1],
		);
		const id = newFootnoteId();
		const target =
			anchor.parentElement?.tagName === "SUP" ? anchor.parentElement : anchor;
		target.replaceWith(buildReference(doc, index + 1, id));
		return { id, legacyNum };
	});

	const list = doc.createElement("ol");
	list.className = "footnotes";
	const consumed = new Set<number>();
	items.forEach(({ id, legacyNum }, index) => {
		const item = doc.createElement("li");
		item.id = `fn:${index + 1}`;
		item.setAttribute("data-id", id);
		const paragraph = doc.createElement("p");
		const body = bodies.get(legacyNum);
		if (body && !consumed.has(legacyNum)) {
			consumed.add(legacyNum);
			moveBodyContent(paragraph, body, hebrewNumeral(legacyNum));
		}
		item.appendChild(paragraph);
		list.appendChild(item);
	});

	const legacyContainers = new Set<Element>();
	for (const legacyNum of consumed) {
		const body = bodies.get(legacyNum);
		const parent = body?.parentElement;
		if (parent && (parent.tagName === "OL" || parent.tagName === "UL")) {
			legacyContainers.add(parent);
		}
		body?.remove();
	}
	for (const container of legacyContainers) removeLegacySection(container);

	root.appendChild(list);
	return root.innerHTML;
}

const BACKREF_CLASS = "footnote-backref";
const BACKREF_SELECTOR = `a.${BACKREF_CLASS}, a[href^="#fnref:"]`;
const BACKREF_LABEL = "↩";

function parseFragment(html: string): Element | null {
	const doc = document.implementation.createHTMLDocument("");
	const root = doc.createElement("div");
	const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true });
	root.appendChild(fragment);
	return root;
}

/**
 * Editor form: legacy markup migrated and the generated jump-back links removed
 * — the editor owns only the footnote text, so they would otherwise pile up.
 */
export function toEditorFootnoteHtml(html: string): string {
	const migrated = migrateLegacyFootnotes(html);
	if (!migrated.includes("#fnref:")) return migrated;
	const root = parseFragment(migrated);
	if (!root) return migrated;
	for (const link of Array.from(root.querySelectorAll(BACKREF_SELECTOR))) {
		link.remove();
	}
	return root.innerHTML;
}

/** Stored/published form: every footnote gets a link back to its reference. */
export function toStoredFootnoteHtml(html: string): string {
	if (!html.includes("footnotes")) return html;
	const root = parseFragment(html);
	const list = root?.querySelector("ol.footnotes");
	if (!root || !list) return html;

	Array.from(list.children).forEach((item, index) => {
		for (const stale of Array.from(item.querySelectorAll(BACKREF_SELECTOR))) {
			stale.remove();
		}
		const link = list.ownerDocument.createElement("a");
		link.className = BACKREF_CLASS;
		link.setAttribute("href", `#fnref:${index + 1}`);
		link.setAttribute("role", "doc-backlink");
		/* The arrow alone gives screen readers no usable name. */
		link.setAttribute("aria-label", `חזרה לאזכור ${hebrewNumeral(index + 1)}`);
		link.textContent = BACKREF_LABEL;
		(item.lastElementChild ?? item).appendChild(link);
	});
	return root.innerHTML;
}
