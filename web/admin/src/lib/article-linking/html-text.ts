/**
 * Plain-text view of article HTML (#3103) — the deterministic matching view
 * citation extraction and evidence anchoring run on. The stored HTML is
 * preserved verbatim in the database; this view exists only in memory, and
 * evidence spans are UTF-16 offsets into it (never HTML offsets).
 */

const BLOCK_TAGS =
	/<\/?(?:p|h[1-6]|div|section|article|header|footer|ul|ol|li|blockquote|table|tr|td|th|br|hr)[^>]*>/gi;
const SKIP_INTERIOR = /<(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi;

/**
 * Removes markup in a single left-to-right scan: `<` switches to in-tag
 * mode until the next `>`, and every other character inside a tag (angle
 * brackets included) is swallowed. Unlike repeated `replace(/<[^>]+>/g)`
 * this cannot re-form a tag from nested/malformed input — the CodeQL
 * "incomplete multi-character sanitization" case (`<<script>script>`
 * reassembling `<script>`). A stray `>` outside a tag is plain text.
 */
function stripTags(input: string): string {
	let out = "";
	let inTag = false;
	for (const ch of input) {
		if (inTag) {
			if (ch === ">") inTag = false;
			continue;
		}
		if (ch === "<") {
			inTag = true;
			continue;
		}
		out += ch;
	}
	return out;
}

const ENTITIES: Record<string, string> = {
	"&quot;": '"',
	"&#34;": '"',
	"&#39;": "'",
	"&#039;": "'",
	"&apos;": "'",
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&nbsp;": " ",
};

/**
 * Extracts the plain-text view: script/style interiors removed, block
 * boundaries become newlines, remaining tags stripped, common entities
 * decoded, whitespace collapsed (never Hebrew content).
 */
export function extractPlainText(html: string): string {
	const withoutScripts = html.replace(SKIP_INTERIOR, "\n");
	const withBreaks = withoutScripts.replace(BLOCK_TAGS, "\n");
	const withoutTags = stripTags(withBreaks);
	const decoded = withoutTags.replace(
		/&(?:quot|amp|lt|gt|nbsp|apos|#0?34|#0?39);/g,
		(entity) => ENTITIES[entity] ?? entity,
	);
	return decoded
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/^[\s\n]+|[\s\n]+$/g, "");
}

/**
 * Locates every exact occurrence of `quote` in the plain-text view —
 * evidence anchoring verifies the model/heuristic quote exists verbatim
 * rather than trusting offsets it supplied.
 */
export function locateQuote(
	plainText: string,
	quote: string,
): { spanStart: number; spanEnd: number } | null {
	const index = plainText.indexOf(quote);
	if (index < 0) return null;
	return { spanStart: index, spanEnd: index + quote.length };
}
