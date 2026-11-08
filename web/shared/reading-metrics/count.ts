/**
 * Hebrew-aware word counting for the shared reading-metrics contract (#2607),
 * calc_version 1. Operates on plain text — HTML handling lives in text.ts,
 * canonical-scripture segment handling in perek.ts.
 *
 * Token policy (documented in docs/data/reading-metrics.md):
 * - NFD-decompose and drop all combining marks (\p{M}) — niqqud and taamim
 *   never become words and never split one.
 * - Quote-like characters (ASCII ' and ", Hebrew geresh ׳ / gershayim ״, and
 *   the typographic quotes) drop entirely — abbreviations like תנ"ך and
 *   שליט"א stay single words.
 * - Maqaf (־) and the ASCII hyphen join the words around them: בית־לחם and
 *   authored hyphens count as one word, matching the authored-text convention
 *   that uses '-' in place of a typographic dash or maqaf.
 * - Letters and digits (any script) are word characters; everything else —
 *   whitespace incl. NBSP, punctuation, sof pasuq — is a separator.
 * - A run reduced to only joiner characters ("-", "־") is not a word.
 */

const COMBINING_MARK = /\p{M}/u;
const QUOTE_LIKE = new Set(["'", '"', "׳", "״", "‘", "’", "“", "”"]);
const JOINER = new Set(["-", "־"]);
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Normalize text to its counted token stream: letter/digit runs that may
 * carry intra-word joiners. Separators collapse to single spaces.
 */
export function normalizeForCount(text: string): string {
	let out = "";
	for (const c of text.normalize("NFD")) {
		if (COMBINING_MARK.test(c) || QUOTE_LIKE.has(c)) continue;
		if (WORD_CHAR.test(c) || JOINER.has(c)) {
			out += c;
		} else if (out.length > 0 && !out.endsWith(" ")) {
			out += " ";
		}
	}
	return out.trimEnd();
}

/** Count the words in one already-normalized token string. */
function tokensOf(normalized: string): string[] {
	if (normalized.length === 0) return [];
	return normalized
		.split(" ")
		.map((token) => {
			// Trim joiners at the edges: "well-known" stays one token while
			// "-word" (a dash punctuation) and bare "-" reduce/drop correctly.
			let start = 0;
			let end = token.length;
			while (start < end && JOINER.has(token[start])) start += 1;
			while (end > start && JOINER.has(token[end - 1])) end -= 1;
			return token.slice(start, end);
		})
		.filter((token) => token.length > 0);
}

/** Word count of plain (markup-free) text under calc_version 1. */
export function countTextWords(text: string): number {
	return tokensOf(normalizeForCount(text)).length;
}
