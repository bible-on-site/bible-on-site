/**
 * Hebrew text normalization for search — a TypeScript port of the native
 * app's `Helpers/SearchText` (see app/BibleOnSite/Helpers/SearchText.cs).
 *
 * Normalization strips Hebrew niqqud/taamim (Unicode combining marks, removed
 * via NFD decomposition), quote-like characters (including Hebrew geresh ׳ and
 * gershayim ״), and punctuation; lowercases; and collapses whitespace — so
 * "בְּרֵאשִׁית" and "בראשית" compare equal.
 */

const MARKS = /[\p{Mn}\p{Mc}]/u;
const QUOTES = new Set([
	"'",
	'"',
	"׳", // Hebrew geresh
	"״", // Hebrew gershayim
	"‘",
	"’",
	"“",
	"”",
]);
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Normalize text for comparison: lowercase, no niqqud/taamim, no quotes,
 * punctuation collapsed to single spaces.
 */
export function normalizeSearchText(text: string): string {
	let builder = "";
	for (const char of text.normalize("NFD")) {
		if (MARKS.test(char)) {
			continue;
		}
		if (QUOTES.has(char)) {
			continue;
		}
		if (LETTER_OR_DIGIT.test(char)) {
			builder += char.toLowerCase();
		} else if (builder.length > 0 && !builder.endsWith(" ")) {
			builder += " ";
		}
	}
	return builder.trim();
}

/** Normalized query/content split into terms. */
export function searchTokens(text: string): string[] {
	const normalized = normalizeSearchText(text);
	return normalized.length === 0 ? [] : normalized.split(" ");
}

/**
 * Like {@link normalizeSearchText} but also maps every output character to the
 * raw string index that produced it — the normalized string is `map.length`
 * characters long. Used to project a normalized match span back onto rendered
 * text (DOM text nodes) for highlighting and scrolling (#2078). Decomposition
 * runs per code point so surrogate pairs keep their raw position.
 */
export function normalizeWithMap(text: string): {
	normalized: string;
	map: number[];
} {
	let normalized = "";
	const map: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const unitLength = (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
		for (const char of text.slice(i, i + unitLength).normalize("NFD")) {
			if (MARKS.test(char) || QUOTES.has(char)) {
				continue;
			}
			if (LETTER_OR_DIGIT.test(char)) {
				normalized += char.toLowerCase();
				map.push(i);
			} else if (normalized.length > 0 && !normalized.endsWith(" ")) {
				normalized += " ";
				map.push(i);
			}
		}
		i += unitLength - 1;
	}
	// normalizeSearchText trims: a trailing emitted space never reaches output.
	while (normalized.endsWith(" ")) {
		normalized = normalized.slice(0, -1);
		map.pop();
	}
	return { normalized, map };
}

const HTML_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "-",
	mdash: "-",
	hellip: "...",
};

const BLOCK_TAGS = /<(br|p|div|li|tr|td|h[1-6]|ul|ol|table|blockquote|section|article|header|footer|hr)\b[^>]*>/gi;
const SCRIPT_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const ALL_TAGS = /<[^>]+>/g;
const ENTITY = /&(#[xX]?[0-9a-fA-F]+|\w+);/g;

function decodeEntities(text: string): string {
	return text.replace(ENTITY, (whole, body: string) => {
		if (body[0] === "#") {
			const hex = body[1] === "x" || body[1] === "X";
			const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
			// Only decode code points that are actually valid single characters.
			return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: whole;
		}
		return HTML_ENTITIES[body] ?? whole;
	});
}

/**
 * Convert stored HTML content to plain searchable text: script/style removed,
 * block-level tags become spaces (word boundaries), entities decoded.
 * Input without markup passes through entity-decoding only.
 */
export function htmlToPlainText(html: string): string {
	if (!html.includes("<")) {
		return decodeEntities(html);
	}
	// Iterate to a fixed point: a single pass can re-form tags from nested
	// fragments (e.g. "<scr<script>ipt>" first reduces to "<script>").
	let text = html;
	let previous = "";
	while (text !== previous) {
		previous = text;
		text = text
			.replace(SCRIPT_STYLE, " ")
			.replace(BLOCK_TAGS, " ")
			.replace(ALL_TAGS, "");
	}
	return decodeEntities(text).trim();
}
