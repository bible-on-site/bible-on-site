import type {
	AuxiliaryReading,
	ReadingUnit,
	ScriptureCoordinate,
	ScriptureRange,
} from "./contract";

/**
 * Total order over canonical scripture positions.
 *
 * Positions compare by perekId, then pasuk, then segment position. A
 * coordinate with no segmentIndex sits at its pasuk edge: it precedes
 * every segmented position as a range start, and follows them as a
 * range end — so callers must say which edge they mean through `edge`.
 */
export type CoordinateEdge = "start" | "end";

function segmentRank(
	coordinate: ScriptureCoordinate,
	edge: CoordinateEdge,
): number {
	if (coordinate.segmentIndex !== undefined) return coordinate.segmentIndex;
	return edge === "start" ? -1 : Number.MAX_SAFE_INTEGER;
}

export function compareCoordinates(
	a: ScriptureCoordinate,
	b: ScriptureCoordinate,
): number;
export function compareCoordinates(
	a: ScriptureCoordinate,
	b: ScriptureCoordinate,
	edge: CoordinateEdge,
): number;
export function compareCoordinates(
	a: ScriptureCoordinate,
	b: ScriptureCoordinate,
	edge: CoordinateEdge = "start",
): number {
	if (a.perekId !== b.perekId) return a.perekId - b.perekId;
	if (a.pasuk !== b.pasuk) return a.pasuk - b.pasuk;
	return segmentRank(a, edge) - segmentRank(b, edge);
}

/**
 * The pasuk-level slice of a range within one perek — the commentary
 * and article query granularity. Verse-addressed content is attached to
 * whole pesukim, so a boundary pasuk belongs to every unit it touches.
 */
export interface PerekSlice {
	perekId: number;
	/** 1-based first pasuk of the slice inside the perek. */
	startPasuk: number;
	/** 1-based last pasuk of the slice inside the perek. */
	endPasuk: number;
	/** Index of the range (in unit.ranges order) this slice came from. */
	rangeIndex: number;
	/** First included segment in startPasuk, when the range starts mid-pasuk. */
	startSegmentIndex?: number;
	/** Last included segment in endPasuk, when the range ends mid-pasuk. */
	endSegmentIndex?: number;
}

/**
 * Decomposes a range into ordered per-perek slices in canonical order.
 * `pasukCount` supplies each perek's pasuk count so bounds inside a
 * perek can be clipped; it must return a positive count.
 */
export function rangePerekSlices(
	range: ScriptureRange,
	pasukCount: (perekId: number) => number,
): PerekSlice[] {
	const slices: PerekSlice[] = [];
	for (
		let perekId = range.start.perekId;
		perekId <= range.end.perekId;
		perekId++
	) {
		const count = pasukCount(perekId);
		const startPasuk =
			perekId === range.start.perekId ? range.start.pasuk : 1;
		const endPasuk =
			perekId === range.end.perekId ? range.end.pasuk : count;
		const slice: PerekSlice = {
			perekId,
			startPasuk,
			endPasuk: Math.min(endPasuk, count),
			rangeIndex: 0,
		};
		if (perekId === range.start.perekId && range.start.segmentIndex !== undefined) {
			slice.startSegmentIndex = range.start.segmentIndex;
		}
		if (perekId === range.end.perekId && range.end.segmentIndex !== undefined) {
			slice.endSegmentIndex = range.end.segmentIndex;
		}
		slices.push(slice);
	}
	return slices;
}

/**
 * Decomposes an ordered list of ranges into per-perek slices. Range
 * order is preserved; slices keep their source range index so callers
 * can preserve reading order (e.g. Haftarah jumps).
 */
export function rangesPerekSlices(
	ranges: ScriptureRange[],
	pasukCount: (perekId: number) => number,
): PerekSlice[] {
	return ranges.flatMap((range, rangeIndex) =>
		rangePerekSlices(range, pasukCount).map((slice) => ({
			...slice,
			rangeIndex,
		})),
	);
}

/**
 * Per-perek slices covering a whole unit: primary ranges plus every
 * auxiliary reading's ranges, all in declared order.
 */
export function unitPerekSlices(
	unit: ReadingUnit,
	pasukCount: (perekId: number) => number,
): PerekSlice[] {
	const allRanges = [
		...unit.ranges,
		...(unit.auxiliaryReadings ?? []).flatMap(
			(aux: AuxiliaryReading) => aux.ranges,
		),
	];
	return rangesPerekSlices(allRanges, pasukCount);
}

/** Distinct perek ids a unit's ranges overlap, in first-appearance order. */
export function unitPerekIds(
	unit: ReadingUnit,
	pasukCount: (perekId: number) => number,
): number[] {
	const seen = new Set<number>();
	for (const slice of unitPerekSlices(unit, pasukCount)) {
		seen.add(slice.perekId);
	}
	return [...seen];
}

/**
 * Whether a (perekId, pasuk) position falls inside a range. Segment
 * bounds do not exclude the boundary pasuk — verse-granularity checks
 * treat any included segment of a pasuk as including the pasuk.
 */
export function rangeContainsPasuk(
	range: ScriptureRange,
	perekId: number,
	pasuk: number,
): boolean {
	return (
		compareCoordinates(range.start, { perekId, pasuk }, "end") <= 0 &&
		compareCoordinates(range.end, { perekId, pasuk }, "start") >= 0
	);
}

/**
 * Segment-aware point containment: whether a canonical position falls
 * inside a range. A coordinate without `segmentIndex` denotes the
 * pasuk's first segment, so a boundary pasuk resolves to the unit where
 * the pasuk begins — matching citation semantics for position->unit
 * resolution. (Pasuk-granular "touches" checks belong to
 * `rangeContainsPasuk` instead.)
 */
export function rangeContainsCoordinate(
	range: ScriptureRange,
	coordinate: ScriptureCoordinate,
): boolean {
	const segment = coordinate.segmentIndex ?? 0;
	const afterStart =
		coordinate.perekId > range.start.perekId ||
		(coordinate.perekId === range.start.perekId &&
			(coordinate.pasuk > range.start.pasuk ||
				(coordinate.pasuk === range.start.pasuk &&
					segment >= (range.start.segmentIndex ?? 0))));
	const beforeEnd =
		coordinate.perekId < range.end.perekId ||
		(coordinate.perekId === range.end.perekId &&
			(coordinate.pasuk < range.end.pasuk ||
				(coordinate.pasuk === range.end.pasuk &&
					segment <=
						(range.end.segmentIndex ?? Number.MAX_SAFE_INTEGER))));
	return afterStart && beforeEnd;
}

/**
 * Whether any primary range of the unit contains the given pasuk
 * position. Auxiliary readings (e.g. Haftarot) point into other units'
 * territory, so position->unit resolution only consults primary ranges.
 */
export function unitContainsPasuk(
	unit: ReadingUnit,
	perekId: number,
	pasuk: number,
): boolean {
	return unit.ranges.some((range) =>
		rangeContainsPasuk(range, perekId, pasuk),
	);
}

/**
 * Whether a range covers exactly one whole perek — used by the
 * canonical-consolidation policy (only equivalent spans may consolidate
 * to the /929 canonical page).
 */
export function rangeIsExactlyOnePerek(
	range: ScriptureRange,
	pasukCount: (perekId: number) => number,
): boolean {
	return (
		range.start.perekId === range.end.perekId &&
		range.start.pasuk === 1 &&
		range.start.segmentIndex === undefined &&
		range.end.pasuk === pasukCount(range.end.perekId) &&
		range.end.segmentIndex === undefined
	);
}

/**
 * The perek id a unit consolidates to, or null when the unit is not an
 * exact single-perek span (no auxiliary readings either).
 */
export function unitEquivalentPerekId(
	unit: ReadingUnit,
	pasukCount: (perekId: number) => number,
): number | null {
	if (unit.ranges.length !== 1 || unit.auxiliaryReadings?.length) return null;
	const [range] = unit.ranges;
	return rangeIsExactlyOnePerek(range, pasukCount)
		? range.start.perekId
		: null;
}
