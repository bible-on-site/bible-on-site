// types.ts
interface TimeSegment {
	type: "string";
	pattern: "^\\d{2}:\\d{2}:\\d{2}$";
}

interface Timeframe {
	from: TimeSegment;
	to: TimeSegment;
}

/**
 * A qri segment (vocalized text).
 * - If ktivOffset is undefined: this is regular text where qri and ktiv are the same
 * - If ktivOffset is set: this is a qri that differs from ktiv, pointing to the ktiv segment
 */
interface QriSegment {
	type: "qri";
	value: string;
	recordingTimeFrame: Timeframe;
	/**
	 * Offset to the paired ktiv segment. Only set when qri differs from ktiv.
	 * Usually negative (ktiv precedes qri), but can be 0 for orphan qri (קרי ולא כתיב).
	 */
	ktivOffset?: number;
}

/**
 * A pure ktiv segment (unvocalized text that differs from qri).
 * Appears adjacent to a qri segment when ktiv differs from qri.
 * Does NOT have recordingTimeFrame since it's not read aloud.
 */
interface KtivSegment {
	type: "ktiv";
	value: string;
	/**
	 * Offset to the paired qri segment. Always set for ktiv segments.
	 * Usually positive (qri follows ktiv), but can be 0 for orphan ktiv (כתיב ולא קרי).
	 */
	qriOffset: number;
}

interface StumaSegment {
	type: "stuma";
}

interface PtuhaSegment {
	type: "ptuha";
}

type Segment = KtivSegment | QriSegment | StumaSegment | PtuhaSegment;

/**
 * Type guard to check if a qri segment differs from the ktiv.
 * If ktivOffset is set (including 0 for orphan), this qri differs from the ktiv.
 * If not set, the qri and ktiv are the same (regular vocalized text).
 */
export function isQriDifferentThanKtiv(segment: QriSegment): boolean {
	return segment.ktivOffset !== undefined;
}

/**
 * Type guard to check if a ktiv segment differs from the qri.
 * Ktiv segments always have qriOffset set (non-zero for pairs, 0 for orphans).
 * Returns true if qriOffset is non-zero (has a paired qri).
 */
export function isKtivDifferentThanQri(segment: KtivSegment): boolean {
	return segment.qriOffset !== 0;
}

interface Pasuk {
	segments: Segment[];
}

interface Perek {
	header: string;
	date: number[];
	star_rise: string[];
	pesukim: Pasuk[];
}

interface AdditionalsItem {
	helek: string;
	letter: string;
	name: string;
	tanachUsName: string;
	pesukimCount: number;
	perakim: Perek[];
	perekFrom: number;
	perekTo: number;
}
type Additionals = [AdditionalsItem, AdditionalsItem];

interface SefarimItemBase {
	name: string;
	helek: string;
	pesukimCount: number;
	perekFrom: number;
	perekTo: number;
}

export interface SefarimItemWithPerakim extends SefarimItemBase {
	tanachUsName: string;
	perakim: Perek[];
}

export interface SefarimItemWithAdditionals extends SefarimItemBase {
	additionals: Additionals;
}

type SefarimItem = SefarimItemWithPerakim | SefarimItemWithAdditionals;

type Sefarim = SefarimItem[];

export type {
	TimeSegment,
	Timeframe,
	KtivSegment,
	QriSegment,
	StumaSegment,
	PtuhaSegment,
	Segment,
	Pasuk,
	Perek,
	AdditionalsItem,
	Additionals,
	SefarimItem,
	Sefarim,
};
