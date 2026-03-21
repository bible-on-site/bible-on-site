import { hebrewOrdinalLetter } from "./adminHebrew";

/** Unlikely plain text; inserted at cursor before HTML bump + setContent. */
export const FOOTNOTE_INSERT_MARKER = "@@ADMIN_FN_ANCHOR_v1@@";

export function maxFootnoteIndex(html: string): number {
	let max = 0;
	for (const m of html.matchAll(
		/#note-(\d+)|id="note-(\d+)"|id="noteref-(\d+)"|id='note-(\d+)'|id='noteref-(\d+)'/g,
	)) {
		const n = Number(m[1] || m[2] || m[3] || m[4] || m[5]);
		if (Number.isFinite(n) && n > max) max = n;
	}
	return max;
}

export function listFootnoteIndices(html: string): number[] {
	const s = new Set<number>();
	for (const m of html.matchAll(
		/#note-(\d+)|id="note-(\d+)"|id="noteref-(\d+)"|id='note-(\d+)'|id='noteref-(\d+)'/g,
	)) {
		const n = Number(m[1] || m[2] || m[3] || m[4] || m[5]);
		if (Number.isFinite(n)) s.add(n);
	}
	return [...s].sort((a, b) => a - b);
}

/**
 * Increments every footnote index >= fromN (new note will occupy `fromN`).
 * Replace from high → low so `#note-10` is not corrupted by `#note-1`.
 */
export function bumpFootnoteNumbersFrom(html: string, fromN: number): string {
	if (fromN < 1) return html;
	const max = maxFootnoteIndex(html);
	if (max < fromN) return html;
	let out = html;
	for (let n = max; n >= fromN; n--) {
		const next = n + 1;
		out = out
			.replaceAll(`#note-${n}"`, `#note-${next}"`)
			.replaceAll(`#note-${n}'`, `#note-${next}'`)
			.replaceAll(`id="note-${n}"`, `id="note-${next}"`)
			.replaceAll(`id="noteref-${n}"`, `id="noteref-${next}"`)
			.replaceAll(`id='note-${n}'`, `id='note-${next}'`)
			.replaceAll(`id='noteref-${n}'`, `id='noteref-${next}'`);
	}
	return out;
}

/** Resync visible marker letter inside `<a href="#note-N" …>…</a>` (TipTap-style attributes). */
export function resyncFootnoteRefLettersFromHtml(html: string): string {
	return html.replace(
		/(<a\s+[^>]*href="#note-(\d+)"[^>]*>)([^<]*)(<\/a>)/gi,
		(_full, open: string, numStr: string, _inner: string, close: string) => {
			const n = Number.parseInt(numStr, 10);
			if (!Number.isFinite(n)) return `${open}${_inner}${close}`;
			return `${open}${hebrewOrdinalLetter(n)}${close}`;
		},
	);
}

/**
 * Before inserting a new footnote as number `slotN`, shift existing indices.
 * `slotN` must be in `1 .. maxFootnoteIndex(html) + 1`.
 */
export function prepareHtmlForNewFootnoteAtSlot(
	html: string,
	slotN: number,
): string {
	const max = maxFootnoteIndex(html);
	if (slotN < 1 || slotN > max + 1) {
		throw new RangeError(
			`מספר הערה ${slotN} מחוץ לטווח 1..${max + 1} (מקסימום נוכחי ${max})`,
		);
	}
	let out = html;
	if (slotN <= max) {
		out = bumpFootnoteNumbersFrom(out, slotN);
	}
	out = resyncFootnoteRefLettersFromHtml(out);
	return out;
}
