/**
 * HTML → readable-text extraction for the shared reading-metrics contract
 * (#2607). Mirrors the corpus normalization the search index already applies
 * (`data/sefaria/pipelines/perushim-view/src/commands/search_text.rs`, ported
 * from the app's `SearchText.PlainText`): script/style blocks vanish entirely,
 * structural boundaries break text, the remaining markup drops silently, and
 * entities decode last so an encoded tag can never turn back into markup.
 *
 * The metrics contract needs block granularity on top of that stream, so the
 * scanner emits one segment per readable block instead of a single string.
 */

/**
 * Block-level elements whose close tag ends a readable block — the unit
 * stored as `*_metric_block` rows for word-weighted progress mapping.
 * Inline formatting tags (b/i/span/a/sup/…) are not boundaries.
 */
const BLOCK_TAGS = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"dd",
	"details",
	"dialog",
	"div",
	"dl",
	"dt",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"li",
	"main",
	"nav",
	"ol",
	"p",
	"pre",
	"section",
	"summary",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
	"ul",
]);

/** Void tags that break text on their own (no close tag needed). */
const VOID_BREAK_TAGS = new Set(["br", "hr"]);

/** ASCII letter — a char-code range beats a one-char regex scan. */
function isAsciiLetter(ch: string): boolean {
	return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

/** Tag-name characters: ASCII letters and digits. */
function isTagNameChar(ch: string): boolean {
	return isAsciiLetter(ch) || (ch >= "0" && ch <= "9");
}

const NAMED_ENTITIES: Record<string, string> = {
	lt: "<",
	gt: ">",
	amp: "&",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/**
 * Decode the entities that appear in stored content: the standard XML set,
 * `nbsp`, and numeric (decimal/hex) references. Unknown or out-of-range
 * entities stay literal — a malformed `&#x110000;` must not throw.
 */
export function decodeEntities(text: string): string {
	if (!text.includes("&")) return text;
	return text.replace(
		/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,
		(entity, body: string) => {
			if (body.startsWith("#x") || body.startsWith("#X")) {
				return decodeNumeric(entity, body.slice(2), 16);
			}
			if (body.startsWith("#")) {
				return decodeNumeric(entity, body.slice(1), 10);
			}
			return NAMED_ENTITIES[body] ?? entity;
		},
	);
}

function decodeNumeric(entity: string, digits: string, radix: 10 | 16): string {
	const codePoint = Number.parseInt(digits, radix);
	return codePoint >= 0 && codePoint <= 0x10ffff
		? String.fromCodePoint(codePoint)
		: entity;
}

/**
 * Locate the earliest `<script>`/`<style>` open tag. Returns
 * `[start, afterEnd]` — the index just past the matching close tag, or just
 * past the open tag when the close is missing.
 */
function findScriptOrStyle(text: string): [number, number] | null {
	const lower = text.toLowerCase();
	let best: [number, number] | null = null;
	for (const name of ["script", "style"]) {
		const open = `<${name}`;
		let search = 0;
		for (;;) {
			const pos = lower.indexOf(open, search);
			if (pos === -1) break;
			if (best && pos >= best[0]) break;
			const at = pos + open.length;
			// The tag name must end at a non-identifier char or EOF, so
			// `<scriptx` never aliases a real script block.
			const next = lower[at];
			if (next === undefined || !isTagNameChar(next)) {
				const close = `</${name}`;
				const closeAt = lower.indexOf(close, at);
				const after = closeAt === -1 ? at : closeAt + close.length + 1;
				best = [pos, Math.min(after, text.length)];
				break;
			}
			search = at;
		}
	}
	return best;
}

/** Remove every `<script>…</script>` and `<style>…</style>` block. */
export function stripScriptsAndStyles(text: string): string {
	if (!text.includes("<")) return text;
	let rest = text;
	let out = "";
	for (;;) {
		const found = findScriptOrStyle(rest);
		if (!found) break;
		out += rest.slice(0, found[0]);
		rest = rest.slice(found[1]);
	}
	return out + rest;
}

interface TagMatch {
	/** Index just past the tag's `>`. */
	end: number;
	/** Lowercased tag name ("" when the construct carried none). */
	name: string;
	closing: boolean;
}

/**
 * Parse a tag starting at `text[start] === '<'`. Returns null when the '<'
 * is literal text (not followed by a letter, '/', '!' or '?'). An
 * unterminated tag consumes to EOF and reports `terminated: false` through
 * `end === text.length` while `name` may be partial — callers then re-emit
 * the consumed span as literal text, matching the corpus convention.
 */
function parseTagAt(
	text: string,
	start: number,
): (TagMatch & { terminated: boolean }) | null {
	const next = text[start + 1];
	if (
		next === undefined ||
		!(isAsciiLetter(next) || next === "/" || next === "!" || next === "?")
	) {
		return null;
	}
	let i = start + 1;
	let closing = false;
	if (text[i] === "/") {
		closing = true;
		i += 1;
	}
	let name = "";
	while (i < text.length && isTagNameChar(text[i])) {
		name += text[i].toLowerCase();
		i += 1;
	}
	let terminated = false;
	while (i < text.length) {
		if (text[i] === ">") {
			terminated = true;
			i += 1;
			break;
		}
		i += 1;
	}
	return { end: i, name, closing, terminated };
}

/**
 * Split authored/stored HTML into readable-text segments: one per readable
 * block, in document order. Entities decode inside each segment, scripts and
 * styles never reach a segment, and every block-boundary tag (closing a
 * block element, `<br>`, `<hr>`) ends the current segment.
 */
export function htmlToReadableSegments(html: string): string[] {
	const cleaned = stripScriptsAndStyles(html);
	const segments: string[] = [];
	let current = "";
	const flush = () => {
		if (current.length > 0) {
			segments.push(current);
			current = "";
		}
	};
	let i = 0;
	while (i < cleaned.length) {
		const c = cleaned[i];
		if (c !== "<") {
			current += c;
			i += 1;
			continue;
		}
		const tag = parseTagAt(cleaned, i);
		if (!tag) {
			current += c;
			i += 1;
			continue;
		}
		if (!tag.terminated) {
			// '<tag' dangling at EOF stays literal text.
			current += cleaned.slice(i);
			break;
		}
		if (
			(tag.closing && BLOCK_TAGS.has(tag.name)) ||
			VOID_BREAK_TAGS.has(tag.name)
		) {
			flush();
		}
		i = tag.end;
	}
	flush();
	return segments.map(decodeEntities);
}

/** Flat readable text of an HTML fragment — the segments joined by spaces. */
export function htmlToPlainText(html: string): string {
	return htmlToReadableSegments(html).join(" ");
}
