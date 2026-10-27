/**
 * Word-weighted reading-position progress (#2607) — pure geometry, no React.
 *
 * The persisted `*_metric_block` / `tanah_perek_pasuk_metric` /
 * `tanah_note_metric` rows give each readable unit a word count and a
 * cumulative word offset. This module maps a scroll position to a fraction
 * of the counted words by locating the rendered unit that straddles the
 * reading anchor and interpolating inside it by its text-line boxes —
 * images, media gaps and other uncounted chrome inside a unit never read
 * as progress.
 *
 * The anchor moves linearly from the scroll content's top at rest to its
 * bottom at max scroll (`scrollTop * scrollHeight / (scrollHeight -
 * clientHeight)`), so a flat 0% → 100% sweep is preserved while the
 * *distribution* between the ends follows counted words rather than
 * pixels. Back-scrolling lowers the value — this is current reading
 * position, not a completion record.
 */

/** Line-box geometry of one rendered text fragment, in content-axis px. */
export interface UnitLineBox {
	top: number;
	height: number;
}

/** One progress unit laid out for lookup: stored words + measured boxes. */
export interface PositionedUnit {
	/**
	 * Words counted before this unit *in rendered (DOM) order* — recomputed
	 * by {@link positionUnits}, because a mixed view (e.g. the Sefer
	 * commentary pane interleaving several perushim by pasuk) orders notes
	 * differently than any single stored `cumulative_words` sequence.
	 */
	wordsBefore: number;
	/** Words this unit contributes. */
	wordCount: number;
	/** Text line boxes in scroll-content coordinates, ordered top→bottom. */
	lines: UnitLineBox[];
	/** Element top — lets an empty/line-less unit still bound the axis. */
	top: number;
	/** Element bottom — same purpose for the axis tail. */
	bottom: number;
}

/**
 * The reading anchor in scroll-content coordinates for a scroller state.
 * `scrollTop / (scrollHeight - clientHeight)` is the familiar ratio, scaled
 * back onto the content axis: 0 at rest, `scrollHeight` fully scrolled.
 * Non-scrollable content returns `scrollHeight` — everything is already in
 * the viewport, i.e. fully "read".
 */
export function readingAnchor(
	scrollTop: number,
	scrollHeight: number,
	clientHeight: number,
): number {
	const range = scrollHeight - clientHeight;
	if (range <= 0) return scrollHeight;
	const clamped = Math.min(Math.max(scrollTop, 0), range);
	return (clamped * scrollHeight) / range;
}

/**
 * Counted words passed at `anchor` px down the content axis.
 *
 * Units before the anchor contribute their full `wordCount`; the unit
 * straddling the anchor contributes the fraction of its words whose text
 * lines are passed — each line box counts equally (a one-word last line is
 * a fair approximation and needs no client-side word counting). An anchor
 * inside a chrome gap between two line boxes resolves to the lines already
 * passed, so tall illustrations or media inside a unit do not inflate it.
 */
export function wordsPassedAt(
	anchor: number,
	units: readonly PositionedUnit[],
): number {
	let passed = 0;
	for (const unit of units) {
		if (unit.bottom <= anchor) {
			passed = unit.wordsBefore + unit.wordCount;
			continue;
		}
		if (unit.top > anchor) break;
		if (unit.lines.length === 0) {
			// No measurable text (e.g. display:none): bound by position only —
			// an anchor inside counts the unit as passed, matching bottom<=top.
			passed = unit.wordsBefore + unit.wordCount;
			break;
		}
		let inside = 0;
		for (const line of unit.lines) {
			const depth = (anchor - line.top) / Math.max(line.height, 1);
			inside += Math.min(Math.max(depth, 0), 1);
		}
		passed =
			unit.wordsBefore + (inside / unit.lines.length) * unit.wordCount;
		break;
	}
	return passed;
}

/** `wordsPassedAt` normalized to the content's total word count. */
export function progressFraction(
	anchor: number,
	units: readonly PositionedUnit[],
	totalWords: number,
): number {
	if (totalWords <= 0 || units.length === 0) return 0;
	return Math.min(Math.max(wordsPassedAt(anchor, units) / totalWords, 0), 1);
}

/**
 * Pair measured geometry with each unit's stored word count, then order by
 * `top` and recompute `wordsBefore` along the *rendered* sequence. Sorting
 * keeps progress honest when a view's DOM order differs from the stored
 * per-kind ordering — the Sefer commentary pane interleaves perushim by
 * pasuk, and every other surface is already in stored order anyway.
 */
export function positionUnits(
	pairs: readonly {
		top: number;
		bottom: number;
		lines: UnitLineBox[];
		wordCount: number;
	}[],
): PositionedUnit[] {
	const sorted = [...pairs].sort(
		(a, b) => a.top - b.top || a.bottom - b.bottom,
	);
	let running = 0;
	return sorted.map((pair) => {
		const unit: PositionedUnit = {
			wordsBefore: running,
			wordCount: pair.wordCount,
			top: pair.top,
			bottom: pair.bottom,
			lines: pair.lines,
		};
		running += pair.wordCount;
		return unit;
	});
}

/**
 * Block-level element names whose *end* closes a readable block — the same
 * set `htmlToReadableSegments` (`web/shared/reading-metrics/text.ts`) scans
 * for on the server, restated here because the website package cannot
 * cross its bundler root. `br` and `hr` are void breaks (hr is already
 * block-level).
 */
const BLOCK_TAGS = [
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
];

/** Selector matching every segment boundary inside a rendered HTML body. */
const BLOCK_SELECTOR = `${BLOCK_TAGS.join(",")},br`;

/** A segment counts only when it carries at least one letter or digit. */
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Split a rendered HTML container into the readable-text segments the
 * counter produced server-side — one segment per run of text between
 * block-boundary closes and `br`/`hr` breaks, in document order.
 *
 * DOM equivalent of `htmlToReadableSegments`: a text node belongs to the
 * segment after as many boundaries as precede it. A block element that
 * *contains* the text node does not precede it (`compareDocumentPosition`
 * reports CONTAINED_BY, not PRECEDING), so nested blocks split exactly
 * where the scanner's close tags did.
 */
export function readableDomSegments(root: Element): Text[][] {
	const boundaries = Array.from(root.querySelectorAll(BLOCK_SELECTOR));
	const walker = root.ownerDocument.createTreeWalker(
		root,
		NodeFilter.SHOW_TEXT,
	);
	const segments: Text[][] = [[]];
	let boundaryIdx = 0;
	let node = walker.nextNode();
	while (node) {
		const text = node as Text;
		// script/style bodies are stripped by sanitization already, but a
		// stray one must not grow a readable segment the counter never saw.
		const inert = text.parentElement?.closest("script,style,noscript");
		if (!inert) {
			while (
				boundaryIdx < boundaries.length &&
				(text.compareDocumentPosition(boundaries[boundaryIdx]) &
					Node.DOCUMENT_POSITION_PRECEDING) !==
					0
			) {
				boundaryIdx += 1;
				// Each boundary closes a segment — even an empty one — so the
				// next text node lands in a fresh bucket.
				segments.push([]);
			}
			segments[segments.length - 1].push(text);
		}
		node = walker.nextNode();
	}
	return segments.filter((segment) =>
		segment.some((text) => WORD_CHAR.test(text.data)),
	);
}
