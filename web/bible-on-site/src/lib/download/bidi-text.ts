/**
 * Bidi-aware text drawing for pdf-lib (issue #2620).
 *
 * pdf-lib draws strictly left-to-right, but it does NOT shape text naively:
 * every string passes through @pdf-lib/fontkit's `layout()`, which resolves
 * the script from the first strong character and — for RTL scripts like
 * Hebrew — reverses the shaped glyph run so the emitted glyphs are already
 * in visual order.
 *
 * Two consequences:
 * 1. Pre-reversing the string (the old `reverseGraphemes` approach) makes
 *    fontkit reverse it a second time — net logical order, i.e. backwards
 *    Hebrew on the page.
 * 2. fontkit reverses the *whole* string as a single run, so embedded
 *    digits/Latin runs inside Hebrew text would come out reversed as well
 *    (e.g. "מחזור 12" would paint "21").
 *
 * The helpers below apply UAX #9 (bidi-js) to split each line into
 * directional runs in visual order, then draw each run left-to-right at its
 * computed x offset. Runs are passed to `page.drawText` in *logical* order
 * so fontkit keeps shaping them correctly (marks stay attached to their
 * base glyphs); RTL runs additionally get mirrored-bracket characters
 * swapped so the glyph reversal lands the proper bracket shapes.
 */

import bidiFactory from "bidi-js";
import type { PDFFont, PDFHexString, PDFPage, RGB } from "pdf-lib";

const bidi = bidiFactory();

/**
 * Memoize `font.encodeText` per (font instance, text). pdf-lib runs a full
 * fontkit layout (shaping) for every `drawText` call, and a calendar PDF
 * repeats the same labels constantly — 12× each weekday header and day
 * number in a year view — so per-instance caching removes the bulk of
 * shaping work in real generation.
 *
 * Keyed by the PDFFont instance: hex glyph ids belong to that document's
 * subset, so the cache must never outlive it (WeakMap → per-document
 * scope). For subset fonts the glyph-registration side effect is
 * idempotent per unique text, so serving repeats from cache is exact.
 *
 * Fonts without `encodeText` (unit-test mocks) pass through untouched.
 */
const encodeCaches = new WeakMap<PDFFont, Map<string, PDFHexString>>();

export function memoizeGlyphEncoding<T extends PDFFont>(font: T): T {
	if (typeof font.encodeText !== "function") return font;
	if (encodeCaches.has(font)) return font;

	const byText = new Map<string, PDFHexString>();
	encodeCaches.set(font, byText);
	const original = font.encodeText.bind(font);
	font.encodeText = (text: string): PDFHexString => {
		const hit = byText.get(text);
		if (hit !== undefined) return hit;
		const encoded = original(text);
		byText.set(text, encoded);
		return encoded;
	};
	return font;
}

/**
 * One visual-order slice of a logical string, ready for `page.drawText`.
 *
 * `text` is the logical substring of the run — for RTL runs with mirrored
 * bracket characters already swapped — so it can be drawn and measured
 * exactly as emitted.
 */
export interface VisualTextRun {
	text: string;
	rtl: boolean;
}

/**
 * Memo for {@link visualTextRuns}: pure in `text`, and documents reuse the
 * same labels constantly (weekday headers ×7 per month, day numbers, perek
 * refs).
 *
 * The map lives for the whole module lifetime — unlike the document-scoped
 * font caches below — so it is bounded: PDF text variety across requests is
 * unbounded (verses, perushim, article titles), and an unbounded Map would
 * leak memory on a long-lived server. FIFO eviction keeps the hot
 * calendar/label strings resident while stale entries age out.
 */
const RUNS_CACHE_MAX = 1024;
const runsCache = new Map<string, VisualTextRun[]>();

/**
 * Resolve `text` into bidi runs in visual (left-to-right) order.
 *
 * The paragraph base direction is auto-detected from the first strong
 * character, so pure-Latin strings come out untouched and Hebrew strings
 * get proper RTL run order.
 */
export function visualTextRuns(text: string): VisualTextRun[] {
	if (!text) return [];
	const cached = runsCache.get(text);
	if (cached) return cached;

	const embedLevels = bidi.getEmbeddingLevels(text, "auto");
	const levels = embedLevels.levels;
	const order = bidi.getReorderedIndices(text, embedLevels);

	const runs: VisualTextRun[] = [];
	let runStart = 0;
	for (let i = 1; i <= order.length; i++) {
		if (i === order.length || levels[order[i]] !== levels[order[i - 1]]) {
			const indices = order.slice(runStart, i);
			runStart = i;
			const lo = Math.min(...indices);
			const hi = Math.max(...indices);
			const rtl = levels[indices[0]] % 2 === 1;
			const logical = text.slice(lo, hi + 1);
			runs.push({ text: rtl ? mirrorBrackets(logical) : logical, rtl });
		}
	}
	if (runsCache.size >= RUNS_CACHE_MAX) {
		// Map iterates in insertion order — the first key is the oldest.
		runsCache.delete(runsCache.keys().next().value ?? "");
	}
	runsCache.set(text, runs);
	return runs;
}

/**
 * Swap each mirrored bracket in an RTL run for its counterpart. fontkit's
 * glyph reversal then positions the correct visual shape (e.g. logical
 * "(אבג)" paints the '(' shape on the left and ')' on the right).
 */
function mirrorBrackets(text: string): string {
	return Array.from(
		text,
		(char) => bidi.getMirroredCharacter(char) ?? char,
	).join("");
}

/**
 * Width memo per embedded font: `widthOfTextAtSize` runs a full fontkit
 * layout (shaping) pass, and one PDF repeats the same labels/sizes many
 * times — and measures each drawn run twice (once for x-placement, once
 * when advancing the draw cursor).
 */
const widthCache = new WeakMap<PDFFont, Map<string, number>>();

function widthOf(font: PDFFont, text: string, size: number): number {
	let byText = widthCache.get(font);
	if (!byText) {
		byText = new Map();
		widthCache.set(font, byText);
	}
	const key = `${size} ${text}`;
	const hit = byText.get(key);
	if (hit !== undefined) return hit;
	const width = font.widthOfTextAtSize(text, size);
	byText.set(key, width);
	return width;
}

/** Total advance width of precomputed visual {@link runs}. */
export function bidiRunsWidth(
	font: PDFFont,
	runs: VisualTextRun[],
	size: number,
): number {
	let width = 0;
	for (const run of runs) {
		width += widthOf(font, run.text, size);
	}
	return width;
}

/** Total advance width of `text` as drawn by {@link drawBidiText}. */
export function bidiTextWidth(
	font: PDFFont,
	text: string,
	size: number,
): number {
	return bidiRunsWidth(font, visualTextRuns(text), size);
}

/**
 * Draw precomputed visual {@link runs} left-to-right starting at `x`.
 * Pair with {@link bidiRunsWidth} so a single UAX #9 pass serves both the
 * measurement and the draw of one label.
 */
export function drawBidiRuns(
	page: PDFPage,
	runs: VisualTextRun[],
	font: PDFFont,
	size: number,
	x: number,
	y: number,
	color: RGB,
): void {
	let cursor = x;
	for (const run of runs) {
		const width = widthOf(font, run.text, size);
		page.drawText(run.text, { x: cursor, y, size, font, color });
		cursor += width;
	}
}

/**
 * Draw `text` (logical order) left-to-right starting at `x`. Each bidi run
 * is measured and drawn identically, so alignment and truncation computed
 * with {@link bidiTextWidth} stay exact.
 */
export function drawBidiText(
	page: PDFPage,
	text: string,
	font: PDFFont,
	size: number,
	x: number,
	y: number,
	color: RGB,
): void {
	drawBidiRuns(page, visualTextRuns(text), font, size, x, y, color);
}
