/**
 * Shared reading-unit contract (version 1).
 *
 * A reading division presents the canonical pesukim corpus sliced into
 * units: על הפרק (/929) uses perakim, מסורה על הפרק (/מסורה) uses
 * Masoretic parashot, פרשה על הפרק (/פרשה) uses synagogue Torah
 * parashiot with auxiliary Haftarah readings. Divisions map scripture —
 * they never copy, renumber, or replace canonical verses.
 *
 * See docs/data/reading-units.md for the full contract.
 */
export const READING_CONTRACT_VERSION = 1 as const;

/** Reading-division identifiers. */
export type DivisionId = "perek" | "masora" | "parasha";

/**
 * A canonical scripture position.
 *
 * - `perekId` — global canonical perek id (1–929), not the printed
 *   chapter number; additional/split books share their sefer's id space.
 * - `pasuk` — 1-based pasuk number within that perek.
 * - `segmentIndex` — optional 0-based index into the pasuk's segment
 *   list for precise intra-pasuk bounds (Masoretic breaks inside a
 *   verse). On a range start it is the first included segment; on a
 *   range end it is the last included segment. Omitted means the whole
 *   pasuk edge: a start without it begins at segment 0, an end without
 *   it finishes on the last segment.
 */
export interface ScriptureCoordinate {
	perekId: number;
	pasuk: number;
	segmentIndex?: number;
}

/**
 * An inclusive canonical range. `start` and `end` are both included in
 * the reading. A range may cover part of a pasuk, whole pesukim, whole
 * perakim, or spans crossing perek boundaries within one sefer.
 */
export interface ScriptureRange {
	start: ScriptureCoordinate;
	end: ScriptureCoordinate;
}

/**
 * An auxiliary reading attached to a unit — e.g. a Haftarah following a
 * Torah parasha. Its `ranges` are an ordered list: the reader presents
 * them in order, preserving jumps between perakim and sefarim and any
 * intentional repeated concluding verses. Nothing may be filled in for
 * skipped text or collapsed for repeated text.
 */
export interface AuxiliaryReading {
	/** Stable identifier within the unit (e.g. "haftara-ashkenazi"). */
	id: string;
	/** Display label (e.g. custom/variant name). */
	label: string;
	ranges: ScriptureRange[];
}

/**
 * A reading unit — the addressable entry inside a division.
 */
export interface ReadingUnit {
	division: DivisionId;
	/** Stable unit id, unique and contiguous within the division. */
	unitId: number;
	/**
	 * Canonical URL slug under the division root — the parasha division
	 * uses its Hebrew parasha name (issue #2738); מסורה keeps the
	 * decimal unitId.
	 */
	slug: string;
	/** Parent sefer canonical name (e.g. "שמואל" for both שמואל א and ב). */
	seferName: string;
	/** 1-based order of this unit inside its sefer. */
	order: number;
	/**
	 * Display heading — the unit's identity within the division's own
	 * hierarchy. For מסורה units this is the sefer name + the parasha's
	 * 1-based ordinal inside that sefer (e.g. "בראשית פרשה ח");
	 * conventional perek/pasuk references stay internal.
	 */
	heading: string;
	/**
	 * Primary reading ranges in order. Most divisions have exactly one.
	 * Ordered multi-range primaries preserve jumps between perakim.
	 */
	ranges: ScriptureRange[];
	/** Auxiliary readings such as Haftarot, when present. */
	auxiliaryReadings?: AuxiliaryReading[];
	/**
	 * For Masoretic units: the boundary break that closes this unit
	 * ("ptuha"/"stuma"), or null for the final unit of a sefer which is
	 * closed by the sefer end rather than a break marker.
	 */
	closingBreak?: "ptuha" | "stuma" | null;
}

/**
 * A reading division descriptor — the instance configuration behind
 * which shared reader components and services run.
 */
export interface ReadingDivision {
	id: DivisionId;
	/** Contract version this division's mapping was produced under. */
	version: number;
	/** Website root path ("/929", "/מסורה", "/פרשה"). */
	rootPath: string;
	/** Distinct navigation label. */
	menuLabel: string;
}
