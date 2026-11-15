import DOMPurify from "isomorphic-dompurify";
import { plainText } from "../seo/jsonld";
import { normalizeFootnoteHtml } from "./normalize-footnotes";

/**
 * HTML → safe snippet for Tanahpedia hover preview API.
 */

/** Tags retained in the final, rendered preview snippet. */
const PREVIEW_OUTPUT_TAGS = ["h2", "h3", "h4", "br"];
/** Structural tags we still need to transform below before the final allowlist. */
const PREVIEW_INPUT_TAGS = ["p", "sup", "hr", ...PREVIEW_OUTPUT_TAGS];

/**
 * Block-level containers whose tag boundaries are word breaks. Turned
 * into spaces BEFORE sanitization so the boundary survives no matter
 * which tags the sanitizer keeps: a stripped block tag must not merge
 * two words the reader sees separately (an `</li><li>` boundary), while
 * a stripped inline tag (`a`, `span`, `b`, `em` …) correctly lets its
 * text flow into the neighbouring word.
 */
const PLAIN_TEXT_BLOCK_BOUNDARY =
	/<\/?(?:address|article|aside|blockquote|caption|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|legend|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|br)\b[^>]*>/gi;

const ELLIPSIS = "…";

export function toPreviewHtml(html: string): string {
	// Sanitize up-front with a vetted sanitizer so the cosmetic transforms below
	// only ever operate on safe, normalized markup. This removes <script> (and
	// its contents), event handlers and any disallowed tags/attributes, closing
	// the XSS surface for this snippet which is rendered via dangerouslySetInnerHTML.
	const safe = DOMPurify.sanitize(html, {
		ALLOWED_TAGS: PREVIEW_INPUT_TAGS,
		ALLOWED_ATTR: [],
	});

	const transformed = safe
		.replace(/\\n/g, "")
		.replace(/\r?\n/g, "")
		.replace(/<sup>[\s\S]*?<\/sup>/gi, "")
		.replace(/<hr\s*\/?>/gi, "")
		.replace(/<h[2-4]>\s*<\/h[2-4]>/gi, "")
		.replace(/<p>([\s\S]*?)<\/p>/gi, "$1<br>")
		.replace(/&nbsp;/g, " ")
		.replace(/[ \t]+/g, " ")
		// Normalize every <br> variant to a canonical form first so the collapse
		// and trim passes below stay linear (no nested quantifiers → no ReDoS).
		.replace(/<br\s*\/?\s*>/gi, "<br>")
		.replace(/(?:<br>\s*){2,}/gi, "<br>")
		.replace(/<br>(\s*<h[2-4]>)/gi, "$1")
		.replace(/(<\/h[2-4]>)\s*<br>/gi, "$1")
		.replace(/^(?:\s|<br>)+/, "")
		.replace(/(?:\s|<br>)+$/, "");

	// Defensive final allowlist (API contract: this snippet is server-sanitized).
	return DOMPurify.sanitize(transformed, {
		ALLOWED_TAGS: PREVIEW_OUTPUT_TAGS,
		ALLOWED_ATTR: [],
	});
}

/**
 * The first `maxWords` whole words of an entry body's readable plain
 * text — the moed-introduction preview (#3381). Stored footnote markup
 * is canonicalized first so legacy bare-anchor markers (which carry
 * their meaning in attributes sanitization discards) become the
 * textless `data-marker` form the render path uses; marker anchors
 * whose note body never canonicalized are stripped whole before their
 * letter can merge into the neighbouring word. Script/style blocks and
 * `<sup>` markers carry no readable words and are dropped up-front;
 * block-level tag boundaries become explicit spaces so no sanitizer
 * policy can merge distinct words, entities are decoded, and remaining
 * tags collapse to whitespace. Whole words only: a truncated excerpt
 * ends exactly at a word boundary with `…`, while a body at or under
 * the limit returns intact with no marker.
 */
export function toPlainTextPreview(html: string, maxWords: number): string {
	const normalized = normalizeFootnoteHtml(html);
	const readable = normalized
		.replace(/<script[\s\S]*?(?:<\/script\s*>|$)/gi, " ")
		.replace(/<style[\s\S]*?(?:<\/style\s*>|$)/gi, " ")
		// Footnote-marker anchors whose note body is absent (or that
		// normalization left untouched) still carry a baked-in marker as
		// their text — strip the whole element before sanitization unwraps
		// it and the letter merges into the neighbouring word.
		.replace(
			/<a\b[^>]*href="#(?:fn:\d+|fnref:\d+|note-\d+|noteref-\d+)[^"]*"[^>]*>[\s\S]*?<\/a\s*>/gi,
			"",
		)
		.replace(
			/<a\b[^>]*data-link-type="comment"[^>]*>[\s\S]*?<\/a\s*>/gi,
			"",
		)
		.replace(/<sup[\s\S]*?(?:<\/sup\s*>|$)/gi, " ")
		.replace(PLAIN_TEXT_BLOCK_BOUNDARY, " ")
		.replace(/\\n/g, "");
	// Defense in depth: extraction above is deterministic already, but the
	// vetted sanitize guarantees nothing unsafe survives if a transform
	// ever lets markup through — the output is plain text regardless.
	const safe = DOMPurify.sanitize(readable, {
		ALLOWED_TAGS: [],
		ALLOWED_ATTR: [],
	});
	const text = plainText(safe, Number.MAX_SAFE_INTEGER);
	if (!text) return "";
	const words = text.split(" ");
	const head = words.slice(0, maxWords).join(" ");
	return words.length > maxWords ? `${head}${ELLIPSIS}` : head;
}

/**
 * Truncate `snippet` so visible text (ignoring HTML tags) is at most `maxLen` chars.
 * Appends ellipsis and closes a dangling `<h2>`–`<h4>` if needed.
 */
export function truncatePreviewSnippet(
	snippet: string,
	maxLen: number,
): string {
	let textLen = 0;
	let cutIdx = 0;
	for (let i = 0; i < snippet.length; i++) {
		if (snippet[i] === "<") {
			const close = snippet.indexOf(">", i);
			if (close !== -1) {
				i = close;
				continue;
			}
		}
		textLen++;
		if (textLen === maxLen) {
			cutIdx = i + 1;
		}
	}
	if (textLen <= maxLen || cutIdx <= 0) return snippet;

	let out = `${snippet.slice(0, cutIdx)}${ELLIPSIS}`;
	const openH = out.match(/<h([2-4])>(?![\s\S]*<\/h[2-4]>)/i);
	if (openH) {
		out += `</h${openH[1]}>`;
	}
	return out;
}
