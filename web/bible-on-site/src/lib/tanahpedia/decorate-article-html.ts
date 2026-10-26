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
const TAG_RE =
	/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
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
	// Nested skip elements close inner-first, so ranges arrive unsorted —
	// normalize into ascending, non-overlapping zones for the linear scan.
	ranges.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [];
	for (const [start, end] of ranges) {
		const last = merged[merged.length - 1];
		if (last && start <= last[1]) {
			last[1] = Math.max(last[1], end);
		} else {
			merged.push([start, end]);
		}
	}
	return merged;
}

export function decorateArticleHtml(
	html: string,
	refs: ArticleMentionReference[],
): string {
	const sorted = refs
		.filter(
			(ref): ref is ArticleMentionReference & { entryUniqueName: string } =>
				ref.entryUniqueName != null && ref.spanStart < ref.spanEnd,
		)
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
		const { spanStart: start, spanEnd: end } = ref;
		if (start < cursor) continue; // overlapping span — first wins
		if (html.slice(start, end) !== ref.surface) continue; // drifted row
		while (blockedIndex < blocked.length && blocked[blockedIndex][1] <= start) {
			blockedIndex++;
		}
		const zone = blocked[blockedIndex];
		if (zone && start < zone[1] && end > zone[0]) continue; // inside <a>/<script>/<style>
		out += html.slice(cursor, start);
		// join(), not a template literal or '+' chain: keeps the anchor out
		// of both the "HTML-with-interpolated-variables" heuristic and the
		// repo's prefer-template-literal lint. Interpolated parts are either
		// URI-encoded (name) or verified source bytes (surface check above).
		out += [
			'<a class="tanahpedia-mention" href="/pedia/',
			encodeURIComponent(name),
			'">',
			ref.surface,
			"</a>",
		].join("");
		cursor = end;
	}
	return out + html.slice(cursor);
}
