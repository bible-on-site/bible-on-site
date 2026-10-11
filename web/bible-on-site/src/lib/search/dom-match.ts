/**
 * Locate a search match inside rendered DOM content for #2078: the element's
 * text nodes are concatenated, normalized with a raw-offset map (the same
 * pipeline the search index applies), the best span is projected back onto
 * the DOM as a raw range, and the matched text is wrapped in <mark> elements
 * for highlighting and scrolling.
 *
 * Indexed/normalized offsets never equal DOM offsets — niqqud, entities and
 * markup all shift them — so the match is re-located in rendered text rather
 * than assumed at a fixed position.
 */

import { normalizeSearchText, normalizeWithMap } from "./normalize";
import { tokenScore } from "./score";

/**
 * Combining-mark code-point blocks (Unicode Mn/Mc) covering Hebrew niqqud and
 * taamim plus the shared diacritical and script mark blocks found in article
 * and commentary markup. Range checks keep regexes off the rendered text.
 */
const COMBINING_MARK_BLOCKS: readonly (readonly [number, number])[] = [
	[0x0300, 0x036f],
	[0x0483, 0x0489],
	[0x0591, 0x05bd],
	[0x05bf, 0x05bf],
	[0x05c1, 0x05c2],
	[0x05c4, 0x05c5],
	[0x05c7, 0x05c7],
	[0x0610, 0x061a],
	[0x064b, 0x065f],
	[0x0670, 0x0670],
	[0x06d6, 0x06dc],
	[0x06df, 0x06e4],
	[0x06e7, 0x06e8],
	[0x06ea, 0x06ed],
	[0x1ab0, 0x1aff],
	[0x1dc0, 0x1dff],
	[0x20d0, 0x20f0],
	[0xfe20, 0xfe2f],
];

function isCombiningMark(codeUnit: number): boolean {
	return COMBINING_MARK_BLOCKS.some(
		([low, high]) => codeUnit >= low && codeUnit <= high,
	);
}

export interface TextNodeSlice {
	node: Text;
	/** Offset of the node's first character in the concatenated raw text. */
	start: number;
}

export interface NormalizedSpan {
	start: number;
	end: number;
}

export interface RawRange {
	start: number;
	end: number;
}

/** Collect the element's text nodes in document order, skipping script/style bodies. */
export function collectTextNodes(root: Element): {
	nodes: TextNodeSlice[];
	text: string;
} {
	const nodes: TextNodeSlice[] = [];
	let text = "";
	const walker = root.ownerDocument.createTreeWalker(
		root,
		NodeFilter.SHOW_TEXT,
		{
			acceptNode(node) {
				const tag = node.parentElement?.tagName;
				return tag !== "SCRIPT" && tag !== "STYLE"
					? NodeFilter.FILTER_ACCEPT
					: NodeFilter.FILTER_REJECT;
			},
		},
	);
	for (let current = walker.nextNode(); current; current = walker.nextNode()) {
		const node = current as Text;
		nodes.push({ node, start: text.length });
		text += node.data;
	}
	return { nodes, text };
}

/**
 * Locate `phrase` inside normalized text — the same ranking the search
 * pipeline scores by: a whole-word phrase first, then a bare substring, then
 * the first word scoring against any query term. Returns a normalized span.
 */
export function locateNormalized(
	normalized: string,
	needle: string,
): NormalizedSpan | null {
	if (normalized.length === 0 || needle.length === 0) {
		return null;
	}
	// Whole-word phrase — the hit the scorer ranks at 100.
	const phraseIndex = ` ${normalized} `.indexOf(` ${needle} `);
	if (phraseIndex >= 0) {
		return { start: phraseIndex, end: phraseIndex + needle.length };
	}
	// Bare substring — prefix/fuzzy hits can land inside a longer word.
	const subIndex = normalized.indexOf(needle);
	if (subIndex >= 0) {
		return { start: subIndex, end: subIndex + needle.length };
	}
	// Token fallback — earliest word scoring against any query term.
	const terms = needle.split(" ").filter((term) => term.length > 0);
	let start = -1;
	for (let i = 0; i <= normalized.length; i++) {
		const inWord = i < normalized.length && normalized[i] !== " ";
		if (inWord && start < 0) {
			start = i;
		}
		if (inWord || start < 0) {
			continue;
		}
		if (terms.some((term) => tokenScore(normalized.slice(start, i), term) > 0)) {
			return { start, end: i };
		}
		start = -1;
	}
	return null;
}

/**
 * Project a normalized span onto raw text via the map from
 * {@link normalizeWithMap}. Combining marks trailing the last letter are
 * included so the highlight covers the whole rendered glyph.
 */
export function rawRangeFromSpan(
	text: string,
	map: number[],
	span: NormalizedSpan,
): RawRange | null {
	if (map.length === 0) {
		return null;
	}
	const clamp = (value: number) => Math.min(Math.max(value, 0), map.length - 1);
	const start = map[clamp(span.start)];
	if (span.end <= span.start) {
		return { start, end: start };
	}
	let end = map[clamp(span.end - 1)] + 1;
	while (end < text.length && isCombiningMark(text.charCodeAt(end))) {
		end++;
	}
	return { start, end };
}

/**
 * Wrap the best `phrase` match inside `root` in <mark class={markClass}>
 * elements — possibly several when the match crosses text-node boundaries.
 * Returns the emitted marks (empty when nothing matches). Callers undo the
 * wrap by replacing each mark with its children.
 */
export function highlightDomMatch(
	root: Element,
	phrase: string,
	markClass: string,
): HTMLElement[] {
	const needle = normalizeSearchText(phrase);
	if (needle.length === 0) {
		return [];
	}
	const { nodes, text } = collectTextNodes(root);
	const { normalized, map } = normalizeWithMap(text);
	const span = locateNormalized(normalized, needle);
	if (!span) {
		return [];
	}
	const match = rawRangeFromSpan(text, map, span);
	/* istanbul ignore next -- locateNormalized only returns non-empty spans,
	   which always map to a non-empty raw range; defensive guard */
	if (!match || match.end <= match.start) {
		return [];
	}
	const marks: HTMLElement[] = [];
	for (const { node, start } of nodes) {
		const nodeEnd = start + node.data.length;
		const from = Math.max(start, match.start);
		const to = Math.min(nodeEnd, match.end);
		if (from >= to) {
			continue;
		}
		const middle = node.splitText(from - start);
		middle.splitText(to - from);
		const mark = root.ownerDocument.createElement("mark");
		mark.className = markClass;
		middle.parentNode?.insertBefore(mark, middle);
		mark.appendChild(middle);
		marks.push(mark);
	}
	return marks;
}
