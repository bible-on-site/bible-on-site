import DOMPurify from "isomorphic-dompurify";
import { JSDOM } from "jsdom";

const HUNDREDS = ["ק", "ר", "ש", "ת"] as const;
const TENS = ["י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"] as const;
const ONES = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"] as const;

/**
 * Hebrew numeral (א, ב … יא, טו, טז …) — the same numbering the admin editor
 * emits (`hebrewNumeral` in adminHebrew.ts) and CSS `counter(x, hebrew)` renders,
 * so a reference and its note always display an identical marker.
 */
export function hebrewNumeral(value: number): string {
	if (!Number.isFinite(value) || value < 1) return ONES[0];
	let remaining = Math.floor(value);
	let out = "";
	while (remaining >= 400) {
		out += HUNDREDS[3];
		remaining -= 400;
	}
	if (remaining >= 100) {
		out += HUNDREDS[Math.floor(remaining / 100) - 1];
		remaining %= 100;
	}
	/* 15 and 16 are written טו/טז so they never spell a divine name. */
	if (remaining === 15 || remaining === 16) {
		return `${out}ט${remaining === 15 ? "ו" : "ז"}`;
	}
	if (remaining >= 10) {
		out += TENS[Math.floor(remaining / 10) - 1];
		remaining %= 10;
	}
	if (remaining >= 1) out += ONES[remaining - 1];
	return out;
}

/*
 * Stored tanahpedia content carries several footnote markup generations, and
 * entries must render correctly without being re-saved through the admin
 * editor (#2615/#2639):
 *
 *   ref  `<sup><a href="#note-1" id="noteref-1">א</a></sup>`   legacy
 *        `<a href="#note-54" data-link-type="comment">נד</a>`   bare-anchor
 *        `<sup id="fnref:1"><a href="#fn:1" role="doc-noteref">א</a></sup>`  current
 *   body `<ol style="list-style:none"><li id="note-1"><sup>א</sup> טקסט`
 *        `<ol><li><p>א טקסט <a href="#noteref-1">↩</a>`         no ids on li
 *        `<p id="note-1"><strong>א.</strong> טקסט`               paragraph form
 *        `<ol class="footnotes"><li id="fn:1">`                 current
 *
 * In every legacy generation the Hebrew marker is baked into the markup as
 * text, so a list counter renders a second marker next to it. This normalizer
 * rewrites all generations to the canonical form (identical to what the admin
 * migration produces on save): `ol.footnotes` + `fn:N`/`fnref:N` ids and no
 * literal marker in the note body.
 *
 * Display contract (#2615): every decorative identifier is presentation, not
 * text — reference links, note labels and the return glyph all render through
 * CSS pseudo-elements fed by `data-marker`, so extracted prose and SEO text
 * stay free of baked-in markers. Anchors keep real hrefs plus `role` /
 * `aria-label`, so assistive technology still gets a usable name.
 */

const REF_LEGACY_HREF = /^#note-(\d+)$/i;
const BODY_LEGACY_ID = /^note-(\d+)$/i;
const BACKREF_LEGACY_HREF = /^#noteref-(\d+)$/i;
const REF_CANON_HREF = /^#fn:(\d+)$/i;
const BODY_CANON_ID = /^fn:(\d+)$/i;
const ANY_MARKER = /fnref:|#note-|#noteref-|id="note-|footnotes/i;

function elementNumber(el: Element, attr: string, pattern: RegExp): number {
	const num = Number(pattern.exec(el.getAttribute(attr) ?? "")?.[1]);
	return Number.isFinite(num) && num > 0 ? num : 0;
}

/** Elements that may hold a footnote body: a list item or a paragraph. */
function bodyElement(el: Element): Element | null {
	if (el.tagName === "LI" || el.tagName === "P") return el;
	return el.closest("li") ?? el.closest("p");
}

/**
 * Removes the hand-baked Hebrew marker at the start of a note body — a leading
 * `<sup>`/`<strong>` element or leading text — but only when its content is
 * exactly the expected marker for this note number. A paragraph that happens
 * to begin with a Hebrew word is left untouched.
 */
function stripLiteralMarker(body: Element, marker: string): void {
	const host = body.querySelector(":scope > p") ?? body;

	/* Element-wrapped marker: `<sup>א</sup>` or `<strong>א.</strong>`. */
	const first = host.firstElementChild;
	if (first && /^(SUP|STRONG|B)$/.test(first.tagName)) {
		const text = (first.textContent ?? "").trim().replace(/[.\s]+$/, "");
		if (text === marker) first.remove();
		return;
	}

	/* Bare text marker: `א טקסט` / `א. טקסט` / `נד טקסט`. */
	for (const node of Array.from(host.childNodes)) {
		if (node.nodeType !== 3 /* TEXT_NODE */) break;
		const match = /^\s*([א-ת]{1,4})([.]?)(\s+|$)/.exec(node.textContent ?? "");
		if (!match) return;
		if (match[1] !== marker) return;
		node.textContent = (node.textContent ?? "").slice(match[0].length);
		return;
	}
}

/** The hand-made heading that introduced a legacy notes section. */
const LEGACY_SECTION_TITLE = /^\s*הערות\s*$/;

function isBlankText(text: string | null): boolean {
	return !(text ?? "").replace(/ /g, " ").trim();
}

/**
 * Drops the emptied "הערות" section furniture (`<hr>`, heading, whitespace)
 * that precedes the canonical list — same contract as the admin migration's
 * `removeLegacySection`: the styled `ol.footnotes` replaces them, so all
 * generations render identically.
 */
function removeLegacySectionFurniture(canonicalList: Element): void {
	let sibling = canonicalList.previousSibling;
	while (sibling) {
		const previous = sibling.previousSibling;
		if (sibling.nodeType === 3 /* TEXT_NODE */) {
			if (!isBlankText(sibling.textContent)) return;
			sibling.remove();
		} else if (sibling.nodeType === 1 /* ELEMENT_NODE */) {
			const el = sibling as Element;
			if (
				/^H[1-6]$/.test(el.tagName) &&
				LEGACY_SECTION_TITLE.test(el.textContent ?? "")
			) {
				el.remove();
			} else {
				/* The `<hr>` that opened the section, or any real content —
				   either way, nothing further to drop. */
				if (el.tagName === "HR") el.remove();
				return;
			}
		} else {
			return;
		}
		sibling = previous;
	}
}

/**
 * Rewrites stored footnote markup of every generation to the canonical
 * `ol.footnotes` + `fn:N`/`fnref:N` form the current editor emits. Idempotent;
 * content without footnotes (or without recognizable footnote structure)
 * returns unchanged.
 */
export function normalizeFootnoteHtml(html: string): string {
	if (!html || !ANY_MARKER.test(html)) return html;

	/* Sanitize up front so the structural rewrites below only ever operate on
	   safe markup; the render pipeline sanitizes the result again. */
	const doc = new JSDOM("").window.document;
	const root = doc.createElement("div");
	root.append(JSDOM.fragment(DOMPurify.sanitize(html)));

	/* ---- collect note bodies, keyed by note number ---- */
	const bodies = new Map<number, Element>();
	const register = (el: Element | null, num: number) => {
		const body = el ? bodyElement(el) : null;
		if (body && num > 0 && !bodies.has(num)) bodies.set(num, body);
	};

	for (const el of Array.from(root.querySelectorAll("[id]"))) {
		register(el, elementNumber(el, "id", BODY_LEGACY_ID));
		register(el, elementNumber(el, "id", BODY_CANON_ID));
	}
	for (const link of Array.from(root.querySelectorAll("a[href]"))) {
		const num = Number(
			BACKREF_LEGACY_HREF.exec(link.getAttribute("href") ?? "")?.[1],
		);
		if (num > 0) register(link, num);
	}

	/* ---- collect references in document order ---- */
	interface Ref {
		anchor: Element;
		host: Element;
		num: number;
	}
	const refs: Ref[] = [];
	for (const anchor of Array.from(root.querySelectorAll("a[href]"))) {
		const href = anchor.getAttribute("href") ?? "";
		const num = Number(
			(REF_CANON_HREF.exec(href) ?? REF_LEGACY_HREF.exec(href))?.[1],
		);
		if (num <= 0) continue;
		/* A `href="#fn:N"`/`#note-N` link inside a note is a cross-reference
		   between notes, not an inline reference — leave it as a plain link. */
		if (
			bodies.size === 0 ||
			Array.from(bodies.values()).some((body) => body.contains(anchor))
		) {
			continue;
		}
		const host =
			anchor.parentElement?.tagName === "SUP" ? anchor.parentElement : anchor;
		refs.push({ anchor, host, num });
	}

	/* A `#note-N` link inside a note body is a cross-reference to another
	   note — retarget it to the canonical id so it keeps working. */
	for (const body of bodies.values()) {
		for (const link of Array.from(body.querySelectorAll("a[href]"))) {
			const num = Number(
				(REF_CANON_HREF.exec(link.getAttribute("href") ?? "") ??
					REF_LEGACY_HREF.exec(link.getAttribute("href") ?? ""))?.[1],
			);
			if (num > 0) link.setAttribute("href", `#fn:${num}`);
		}
	}

	const hasFootnoteList = root.querySelector("ol.footnotes") !== null;
	if (bodies.size === 0 && refs.length === 0 && !hasFootnoteList) return html;

	/* ---- canonicalize note bodies ---- */
	const canonicalList = doc.createElement("ol");
	canonicalList.className = "footnotes";
	const placeholder = doc.createElement("wbr");
	let anchored = false;
	const processed = new Set<Element>();

	for (const [num, body] of Array.from(bodies.entries()).sort(
		(a, b) => a[0] - b[0],
	)) {
		/* One body may be reachable under two numbers (an li carrying both
		   id="note-1" and a #noteref-2 backlink) — process it once. */
		if (processed.has(body)) continue;
		processed.add(body);
		stripLiteralMarker(body, hebrewNumeral(num));

		/* Legacy jump-back links are re-emitted canonically below. */
		for (const stale of Array.from(
			body.querySelectorAll('a[href^="#noteref-"], a.footnote-backref'),
		)) {
			stale.remove();
		}

		let item: Element;
		if (body.tagName === "LI") {
			item = body;
			if (!anchored) {
				const container = item.parentElement;
				if (
					container &&
					(container.tagName === "OL" || container.tagName === "UL")
				) {
					/* The canonical list replaces the legacy one wholesale. */
					container.insertAdjacentElement("beforebegin", placeholder);
				} else {
					container?.insertBefore(placeholder, item);
				}
				anchored = true;
			}
		} else {
			/* Paragraph-form body: the item takes the paragraph's position. */
			item = doc.createElement("li");
			if (!anchored) {
				const container = body.parentElement;
				if (
					container &&
					(container.tagName === "OL" || container.tagName === "UL")
				) {
					container.insertAdjacentElement("beforebegin", placeholder);
				} else {
					body.insertAdjacentElement("beforebegin", placeholder);
				}
				anchored = true;
			}
			while (body.firstChild) item.appendChild(body.firstChild);
			body.remove();
		}
		item.id = `fn:${num}`;
		/* The marker travels in data-marker so CSS attr() and platform renderers
		   display the note's own number — sparse numbering (a lone note 54)
		   must not collapse to its list position. */
		item.setAttribute("data-marker", hebrewNumeral(num));
		canonicalList.appendChild(item);
	}

	/* Replace the first legacy container (or the placeholder point for
	   paragraph-form bodies) with the canonical list; drop emptied lists. */
	if (canonicalList.childElementCount > 0) {
		if (anchored) {
			placeholder.replaceWith(canonicalList);
		} else {
			root.appendChild(canonicalList);
		}
		for (const list of Array.from(root.querySelectorAll("ol, ul"))) {
			if (list !== canonicalList && list.childElementCount === 0) {
				list.remove();
			}
		}
		removeLegacySectionFurniture(canonicalList);
	}

	/* ---- canonicalize references ---- */
	const firstRefId = new Map<number, string>();
	const usedRefIds = new Set<string>();
	for (const { anchor, host, num } of refs) {
		let refId = `fnref:${num}`;
		for (let suffix = 2; usedRefIds.has(refId); suffix++) {
			refId = `fnref:${num}-${suffix}`;
		}
		usedRefIds.add(refId);
		if (!firstRefId.has(num)) firstRefId.set(num, refId);

		anchor.setAttribute("href", `#fn:${num}`);
		anchor.setAttribute("role", "doc-noteref");
		const classes = new Set((anchor.getAttribute("class") ?? "").split(" "));
		classes.add("footnote-ref");
		anchor.setAttribute("class", Array.from(classes).filter(Boolean).join(" "));
		/* The visible marker is generated by CSS from data-marker (#2615): it
		   stays out of extracted text/SEO. The letter is derived from the note
		   number, so legacy literal text (or a missing label) is replaced —
		   aria-label keeps a real accessible name for the link. */
		anchor.setAttribute("data-marker", hebrewNumeral(num));
		anchor.setAttribute("aria-label", `הערה ${hebrewNumeral(num)}`);
		anchor.textContent = "";

		if (host.tagName === "SUP") {
			host.id = refId;
		} else {
			const sup = doc.createElement("sup");
			sup.id = refId;
			anchor.replaceWith(sup);
			sup.appendChild(anchor);
		}
	}

	/* ---- canonical jump-back link on every referenced note ---- */
	for (const item of Array.from(canonicalList.children)) {
		const num = elementNumber(item, "id", BODY_CANON_ID);
		const target = firstRefId.get(num);
		/* A note nobody references gets no link to a missing anchor. */
		if (!target) continue;
		const link = doc.createElement("a");
		link.className = "footnote-backref";
		link.setAttribute("href", `#${target}`);
		link.setAttribute("role", "doc-backlink");
		link.setAttribute("aria-label", `חזרה לאזכור ${hebrewNumeral(num)}`);
		/* The return glyph is generated by CSS — kept out of note text. */
		(item.lastElementChild ?? item).appendChild(link);
	}

	return root.innerHTML;
}
