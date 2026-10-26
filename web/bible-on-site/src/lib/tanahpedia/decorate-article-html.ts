import type { ArticleMentionReference } from "./service";

/**
 * Injects Tanahpedia anchors into stored article HTML at pipeline
 * character offsets (#2516). Runs server-side before DOMPurify; a plain
 * `<a>` carries the same dashed affordance the pasuk renderer gives its
 * entity links (styled under `.articleBody` in the article stylesheet).
 *
 * Safety rules, all checked against the stored bytes:
 * - only refs whose `surface` exactly equals the span's raw text — a
 *   drifted or hand-rolled row can never inject markup;
 * - spans never overlap (first wins, same as segment refs);
 * - spans inside <a>/<script>/<style> are never wrapped — no nested
 *   anchors or decorated code;
 * - unresolved refs (`entryUniqueName: null`) stay plain text.
 */

const SKIP_TAGS = new Set(["a", "script", "style"]);
const TAG_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const TAG_NAME_RE = /^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/;

/** Byte ranges where decoration is forbidden (mirrors the pipeline's tokenizer). */
function blockedRanges(html: string): Array<readonly [number, number]> {
	const ranges: Array<readonly [number, number]> = [];
	const open: number[] = [];
	for (const match of html.matchAll(TAG_RE)) {
		const tag = match[0];
		const index = match.index;
		const name = TAG_NAME_RE.exec(tag)?.[1]?.toLowerCase();
		if (!name || !SKIP_TAGS.has(name)) continue;
		if (tag.startsWith("</")) {
			const start = open.pop();
			if (start !== undefined) {
				ranges.push([start, index + tag.length]);
			}
		} else if (!tag.endsWith("/>")) {
			open.push(index);
		}
	}
	// An unclosed skip element blocks the remainder of the document.
	for (const start of open) {
		ranges.push([start, html.length]);
	}
	return ranges;
}

export function decorateArticleHtml(
	html: string,
	refs: ArticleMentionReference[],
): string {
	const sorted = refs
		.filter((ref) => ref.entryUniqueName != null && ref.spanStart < ref.spanEnd)
		.sort((a, b) => a.spanStart - b.spanStart);
	if (sorted.length === 0) {
		return html;
	}
	const blocked = blockedRanges(html);
	let blockedIndex = 0;
	let cursor = 0;
	let out = "";
	for (const ref of sorted) {
		const name = ref.entryUniqueName;
		if (name == null) continue;
		const { spanStart: start, spanEnd: end } = ref;
		if (start < cursor) continue; // overlapping span — first wins
		if (html.slice(start, end) !== ref.surface) continue; // drifted row
		while (
			blockedIndex < blocked.length &&
			blocked[blockedIndex][1] <= start
		) {
			blockedIndex++;
		}
		const zone = blocked[blockedIndex];
		if (zone && start < zone[1] && end > zone[0]) continue; // inside <a>/<script>/<style>
		out += html.slice(cursor, start);
		out += `<a class="tanahpedia-mention" href="/pedia/${encodeURIComponent(name)}">${ref.surface}</a>`;
		cursor = end;
	}
	return out + html.slice(cursor);
}
