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
	if (!/[^\p{ASCII}\u0590-\u05ff\u2000-\u206f]/u.test(text)) {
		// These ranges have no letters requiring NFD decomposition or
		// contextual casing. Explicit classes avoid Unicode property scans
		// over the ordinary Hebrew corpus; other scripts keep the full path.
		return text
			.replace(
				/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7'"׳״‘’“”]/g,
				"",
			)
			.replace(/[^A-Za-z0-9\u05d0-\u05ea\u05ef-\u05f2]+/g, " ")
			.trim()
			.toLowerCase();
	}
	return (
		text
			.normalize("NFD")
			.replace(/[\p{Mn}\p{Mc}'"׳״‘’“”]/gu, "")
			.replace(/[^\p{L}\p{N}]+/gu, " ")
			.trim()
			// Preserve per-code-point casing: whole-string lowercasing changes
			// final Greek sigma. Hebrew text needs no callback at all.
			.replace(/[\p{Uppercase}\p{Lt}]/gu, (char) => char.toLowerCase())
	);
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
// Canonical (NFD) decomposition is a fixed per-code-point mapping — the
// verdict is computed once per distinct char through the real normalize, so
// corpus chars never re-enter it. Astral units take the slow path always.
const decomposes = new Map<number, boolean>();

function needsDecompose(code: number): boolean {
	let flag = decomposes.get(code);
	if (flag === undefined) {
		const unit = String.fromCharCode(code);
		flag = unit.normalize("NFD") !== unit;
		decomposes.set(code, flag);
	}
	return flag;
}

export function normalizeWithMap(text: string): {
	normalized: string;
	map: number[];
} {
	// Output accumulates in an array joined once: appending to a growing
	// string and probing it with `endsWith(" ")` re-flattened the whole V8
	// rope at every punctuation boundary — quadratic on long content (#2956).
	const parts: string[] = [];
	const map: number[] = [];
	// True while output is empty or ends in the emitted separator space —
	// the state `endsWith(" ")` used to answer.
	let endsInSpace = true;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		const unitLength = code >= 0xd800 && code <= 0xdbff ? 2 : 1;
		const decomposed =
			unitLength === 1 && !needsDecompose(code)
				? text[i]
				: text.slice(i, i + unitLength).normalize("NFD");
		for (const char of decomposed) {
			if (MARKS.test(char) || QUOTES.has(char)) {
				continue;
			}
			if (LETTER_OR_DIGIT.test(char)) {
				const lowered = char.toLowerCase();
				parts.push(lowered);
				endsInSpace = false;
				// One map entry per emitted UTF-16 unit, like the C# twin —
				// astral letters occupy two units and both map to the pair start.
				for (let u = 0; u < lowered.length; u++) {
					map.push(i);
				}
			} else if (map.length > 0 && !endsInSpace) {
				parts.push(" ");
				map.push(i);
				endsInSpace = true;
			}
		}
		i += unitLength - 1;
	}
	// A separator space emits only after a non-space char, so at most one
	// trails — drop it like normalizeSearchText's trim.
	if (endsInSpace && map.length > 0) {
		parts.pop();
		map.pop();
	}
	return { normalized: parts.join(""), map };
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

const BLOCK_TAGS =
	/<(br|p|div|li|tr|td|h[1-6]|ul|ol|table|blockquote|section|article|header|footer|hr)\b[^>]*>/gi;
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
	while (text !== previous && text.includes("<")) {
		previous = text;
		text = text
			.replace(SCRIPT_STYLE, " ")
			.replace(BLOCK_TAGS, " ")
			.replace(ALL_TAGS, "");
	}
	return decodeEntities(text).trim();
}
