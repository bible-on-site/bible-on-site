/**
 * Canonical scripture → Markdown rendering (issue #3257).
 *
 * The corpus is data-owned, so this module renders the SAME segment
 * lists the site pages render — never a second editorial copy:
 * qri text is emitted (vocalized), ktiv-only segments whose paired
 * qri is already printed are skipped (orphan ktiv — כתיב ולא קרי —
 * is kept, marked like the page does), and Masoretic stuma/ptuha
 * markers print as (ס)/(פ) at the exact segment position, which is
 * what preserves mid-pasuk Masoretic boundaries.
 */
import { toLetters } from "gematry";
import { getPerekByPerekId } from "@/data/perek-dto";
import {
	isKtivDifferentThanQri,
	type Pasuk,
	type Segment,
} from "@/data/db/tanah-view-types";
import type { ScriptureRange } from "@/lib/reading/contract";
import { formatCoordinateSpan } from "@/lib/reading/format";
import { rangesPerekSlices } from "@/lib/reading/ranges";

/** Break markers print inline, at their segment position. */
function segmentText(segment: Segment): string | null {
	if (segment.type === "ptuha") return "(פ)";
	if (segment.type === "stuma") return "(ס)";
	if (segment.type === "ktiv") {
		// A paired ktiv's printed text is its qri — skip to avoid
		// duplicating the word. Orphan ktiv (כתיב ולא קרי, qriOffset 0)
		// has nothing printed elsewhere, so it renders with a marker.
		return isKtivDifferentThanQri(segment) ? null : `[כתיב: ${segment.value}]`;
	}
	// qri: regular text prints as-is; a qri that differs from its ktiv
	// prints the qri value (matching the page, which shows qri).
	return segment.value;
}

/**
 * One pasuk's segment list → its printed line text. Segment bounds
 * (`startSegmentIndex`/`endSegmentIndex`) clip the list BEFORE
 * rendering, so a mid-pasuk Masoretic slice never prints the pasuk's
 * out-of-range side.
 */
export function pasukText(
	pasuk: Pasuk,
	startSegmentIndex?: number,
	endSegmentIndex?: number,
): string {
	const from = startSegmentIndex ?? 0;
	const to =
		endSegmentIndex === undefined ? pasuk.segments.length : endSegmentIndex + 1;
	const segments = pasuk.segments.slice(from, to);
	const words: string[] = [];
	for (const segment of segments) {
		const text = segmentText(segment);
		if (text === null) continue;
		if (text === "") continue;
		// Maqaf joins to the previous word's spacing the same way the
		// raw segment stream does — no extra handling needed since each
		// segment is already a whole word/phrase token.
		words.push(text);
	}
	return words.join(" ").replace(/\s+/g, " ").trim();
}

/** Full pasuk line with its Hebrew letter label (`א. בראשית ...`). */
export function pasukLine(pasuk: Pasuk, pasukNumber: number): string {
	return `${toLetters(pasukNumber)}. ${pasukText(pasuk)}`;
}

/**
 * Ordered scripture ranges → Markdown lines.
 *
 * Ranges render in declared order with their `rangeIndex` preserved —
 * Haftarah jumps between perakim/sefarim and intentional repeated
 * concluding pesukim are kept, never re-sorted or deduplicated. A
 * perek transition emits a bold source line (`**שמואל א יב**`) so the
 * reader always knows which canonical perek the following pesukim are
 * from; a multi-range reading adds a `**range ref**` line per range.
 */
export function scriptureMarkdown(ranges: ScriptureRange[]): string {
	if (ranges.length === 0) return "";
	const slices = rangesPerekSlices(
		ranges,
		(perekId) => getPerekByPerekId(perekId).pesukim.length,
	);
	const multiRange = ranges.length > 1;
	const distinctPereks = new Set(slices.map((s) => s.perekId));
	const lines: string[] = [];
	let lastRangeIndex = -1;
	let lastPerekId = -1;
	for (const slice of slices) {
		if (multiRange && slice.rangeIndex !== lastRangeIndex) {
			const range = ranges[slice.rangeIndex];
			lines.push(`**${formatCoordinateSpan(range.start, range.end)}**`);
			lastPerekId = -1;
		}
		lastRangeIndex = slice.rangeIndex;
		if (distinctPereks.size > 1 && slice.perekId !== lastPerekId) {
			lines.push(`**${getPerekByPerekId(slice.perekId).source}**`);
		}
		lastPerekId = slice.perekId;
		const perek = getPerekByPerekId(slice.perekId);
		for (
			let pasukNumber = slice.startPasuk;
			pasukNumber <= slice.endPasuk;
			pasukNumber++
		) {
			const pasuk = perek.pesukim[pasukNumber - 1];
			/* istanbul ignore next: slices are clamped to pesukim.length by
			 * rangesPerekSlices, so an index can only miss on corrupt data. */
			if (!pasuk) continue;
			const start =
				pasukNumber === slice.startPasuk
					? slice.startSegmentIndex
					: undefined;
			const end =
				pasukNumber === slice.endPasuk ? slice.endSegmentIndex : undefined;
			const text = pasukText(pasuk, start, end);
			lines.push(`${toLetters(pasukNumber)}. ${text}`.trimEnd());
		}
	}
	return lines.join("\n");
}
