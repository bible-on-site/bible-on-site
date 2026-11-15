import DOMPurify from "isomorphic-dompurify";
import { plainText } from "../seo/jsonld";

/**
 * HTML → safe snippet for Tanahpedia hover preview API.
 */

/** Tags retained in the final, rendered preview snippet. */
const PREVIEW_OUTPUT_TAGS = ["h2", "h3", "h4", "br"];
/** Structural tags we still need to transform below before the final allowlist. */
const PREVIEW_INPUT_TAGS = ["p", "sup", "hr", ...PREVIEW_OUTPUT_TAGS];

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
 * text — the moed-introduction preview (#3381). Script/style blocks
 * carry no readable words and are dropped up-front (belt to the
 * sanitizer's suspenders); the same vetted sanitize as `toPreviewHtml`
 * then removes every unsafe construct, `<sup>` footnote/UI markers are
 * removed rather than flattening their digits into words, entities are
 * decoded and block tags become word boundaries — `</p><p>` can never
 * merge two words. Whole words only: a truncated excerpt ends exactly
 * at a word boundary with `…`, while a body at or under the limit
 * returns intact with no marker.
 */
export function toPlainTextPreview(html: string, maxWords: number): string {
	const withoutExecutable = html
		.replace(/<script[\s\S]*?(?:<\/script\s*>|$)/gi, " ")
		.replace(/<style[\s\S]*?(?:<\/style\s*>|$)/gi, " ");
	const safe = DOMPurify.sanitize(withoutExecutable, {
		ALLOWED_TAGS: PREVIEW_INPUT_TAGS,
		ALLOWED_ATTR: [],
	});
	const text = plainText(
		safe.replace(/\\n/g, "").replace(/<sup[\s\S]*?(?:<\/sup\s*>|$)/gi, " "),
		Number.MAX_SAFE_INTEGER,
	);
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
