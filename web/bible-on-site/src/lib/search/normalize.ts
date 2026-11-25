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

/**
 * Block-level tag boundaries: every open or close tag of one of these names is
 * a word break, and adjacent ones collapse into a single break. Shared with
 * the app (`app/BibleOnSite/Helpers/SearchText.cs`), the shipped index builder
 * (`data/sefaria/pipelines/perushim-view/src/commands/search_text.rs`) and the
 * article-search service (`web/api/src/services/article_search/text.rs`) — all
 * four must emit the same plain text for the same HTML.
 */
const BLOCK_TAGS = new Set([
	"br",
	"p",
	"div",
	"li",
	"tr",
	"td",
	"th",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"table",
	"blockquote",
	"section",
	"article",
	"header",
	"footer",
	"hr",
]);
// Sticky/global regexes are reused with `lastIndex` set per walk, so the scan
// is linear — slicing the remainder per character would be quadratic.
const SCRIPT_STYLE = /<(script|style)\b[^>]*>?/iy;
const SCRIPT_CLOSE = /<\/script\s*>/gi;
const STYLE_CLOSE = /<\/style\s*>/gi;
const TAG_NAME = /<\/?([a-zA-Z0-9]+)/iy;
const TAG_START = /[a-zA-Z/!?]/;
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
 *
 * A single character walk like the Rust ports: whichever of `<!--`, a
 * script/style body or a `<…>` tag comes first wins, so markup inside a
 * comment (e.g. `<!-- <style> -->`) is never a real element and a `<!--`
 * inside a skipped body stays inert. An unterminated comment or script/style
 * block swallows to end of input like an HTML parser treats it; a `<` that
 * cannot open markup stays literal text, so no `<!--` or `<script` fragment
 * ever survives the pass.
 */
export function htmlToPlainText(html: string): string {
	if (!html.includes("<")) {
		return decodeEntities(html);
	}
	let out = "";
	let i = 0;
	while (i < html.length) {
		if (html[i] !== "<") {
			out += html[i];
			i += 1;
			continue;
		}
		// A comment emits nothing — HtmlAgilityPack keeps it as an inert node.
		if (html.startsWith("<!--", i)) {
			const end = html.indexOf("-->", i + 4);
			i = end === -1 ? html.length : end + 3;
			continue;
		}
		// A script/style block drops through its close tag (or end of input).
		SCRIPT_STYLE.lastIndex = i;
		const skip = SCRIPT_STYLE.exec(html);
		if (skip) {
			const closeRe =
				skip[1].toLowerCase() === "script" ? SCRIPT_CLOSE : STYLE_CLOSE;
			closeRe.lastIndex = i + skip[0].length;
			const close = closeRe.exec(html);
			i = close === null ? html.length : close.index + close[0].length;
			continue;
		}
		// `<` opens a tag only before a letter, '/', '!' or '?' — anything
		// else (including end of input) stays literal text.
		const next = html[i + 1];
		if (next === undefined || !TAG_START.test(next)) {
			out += "<";
			i += 1;
			continue;
		}
		const end = html.indexOf(">", i + 1);
		if (end === -1) {
			// An unterminated `<tag` at end of input stays literal text.
			out += html.slice(i);
			break;
		}
		TAG_NAME.lastIndex = i;
		const name = TAG_NAME.exec(html)?.[1]?.toLowerCase() ?? "";
		// A boundary emits one space only when the output doesn't already end
		// in one — the same dedup the other three ports apply.
		if (BLOCK_TAGS.has(name) && !out.endsWith(" ")) {
			out += " ";
		}
		i = end + 1;
	}
	return decodeEntities(out).trim();
}
