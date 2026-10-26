/**
 * Canonical-scripture counting for the shared reading-metrics contract
 * (#2607). Produces per-pasuk word counts from the tanah-view corpus —
 * the same segment model the website renders and `pasukPlainText`
 * (`src/lib/tanach/pasuk-plain-text.ts`) flattens.
 *
 * Reading choice: consistent with the site's normal readable text — a ktiv
 * segment paired with a differing qri (qriOffset ≠ 0) is skipped, while an
 * orphan ktiv (כתיב ולא קרי, qriOffset = 0) is the only written form and is
 * counted exactly as `pasukPlainText` renders it. Section marks
 * (פתוחה/סתומה) are layout, not words. Maqaf glues: a segment value ending
 * in ־ continues the current word, matching the counting policy.
 */

/** Minimal structural shape of a tanah-view pasuk segment. */
export interface CorpusSegment {
	type: "qri" | "ktiv" | "ptuha" | "stuma";
	value?: string;
	/** Set on ktiv that differs from its qri pair (0 = orphan ktiv). */
	qriOffset?: number;
}

export interface CorpusPasuk {
	segments: CorpusSegment[];
}

/** A segment carries readable text only when it has a value. */
function segmentText(segment: CorpusSegment): string {
	return segment.value ?? "";
}

/**
 * Whether a ktiv segment has a paired qri (the qri is read instead).
 * Mirrors `isKtivDifferentThanQri` in the website's tanah-view types.
 */
function isKtivReplacedByQri(segment: CorpusSegment): boolean {
	return (
		segment.type === "ktiv" &&
		segment.qriOffset !== undefined &&
		segment.qriOffset !== 0
	);
}

/**
 * The counted (qri) word stream of one pasuk: vocalized segments joined in
 * order, ktiv variants with a qri pair and section marks skipped, and a
 * trailing maqaf gluing the next word without a separator.
 */
export function pasukCountedText(pasuk: CorpusPasuk): string {
	const words: string[] = [];
	let glue = false;
	for (const segment of pasuk.segments) {
		if (segment.type === "ptuha" || segment.type === "stuma") continue;
		if (isKtivReplacedByQri(segment)) continue;
		const value = segmentText(segment);
		if (glue && words.length > 0) {
			words[words.length - 1] += value;
		} else {
			words.push(value);
		}
		glue = value.endsWith("־");
	}
	return words.join(" ").trim();
}
