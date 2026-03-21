import type { PerekEntityReference } from "./service";

export type EntityRefLookup = Map<number, PerekEntityReference[]>;

/**
 * Groups entity references by pasuk number for O(1) lookup during rendering.
 * References with null segmentStart/segmentEnd apply to the entire pasuk.
 */
export function buildEntityRefLookup(
	refs: PerekEntityReference[],
): EntityRefLookup {
	const lookup: EntityRefLookup = new Map();
	for (const ref of refs) {
		if (!ref.entryUniqueName) continue;
		const existing = lookup.get(ref.pasukNumber);
		if (existing) {
			existing.push(ref);
		} else {
			lookup.set(ref.pasukNumber, [ref]);
		}
	}
	return lookup;
}

/**
 * A run of consecutive segments: either all linked to the same entity ref,
 * or all plain (no ref). Used to render one `<Link>` per entity occurrence.
 */
export interface SegmentRun {
	startIdx: number;
	endIdx: number;
	ref: PerekEntityReference | null;
}

/**
 * Partitions a pasuk's segments into contiguous runs, each either linked
 * to a single entity reference (one `<a>`) or plain (no link).
 */
export function getSegmentRuns(
	lookup: EntityRefLookup,
	pasukNumber: number,
	segmentCount: number,
): SegmentRun[] {
	const refs = lookup.get(pasukNumber);

	if (!refs || refs.length === 0) {
		return [{ startIdx: 0, endIdx: segmentCount - 1, ref: null }];
	}

	const refForSegment = (idx: number): PerekEntityReference | null => {
		let wholePasukRef: PerekEntityReference | null = null;
		for (const ref of refs) {
			if (ref.segmentStart != null && ref.segmentEnd != null) {
				if (idx >= ref.segmentStart && idx <= ref.segmentEnd) {
					return ref;
				}
			} else if (!wholePasukRef) {
				wholePasukRef = ref;
			}
		}
		return wholePasukRef;
	};

	const runs: SegmentRun[] = [];
	let currentRef = refForSegment(0);
	let runStart = 0;

	for (let i = 1; i < segmentCount; i++) {
		const segRef = refForSegment(i);
		const sameRun =
			currentRef === segRef ||
			(currentRef != null &&
				segRef != null &&
				currentRef.entityId === segRef.entityId &&
				currentRef.segmentStart === segRef.segmentStart);

		if (!sameRun) {
			runs.push({ startIdx: runStart, endIdx: i - 1, ref: currentRef });
			currentRef = segRef;
			runStart = i;
		}
	}
	runs.push({ startIdx: runStart, endIdx: segmentCount - 1, ref: currentRef });

	return runs;
}
