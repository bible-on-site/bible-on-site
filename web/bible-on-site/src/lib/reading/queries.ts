import { getPerekByPerekId } from "@/data/perek-dto";
import type { ScriptureRange } from "./contract";
import { type PerekSlice, rangesPerekSlices } from "./ranges";

/** Pasuk count of a canonical perek, from the corpus. */
export function canonicalPasukCount(perekId: number): number {
	return getPerekByPerekId(perekId).pesukim.length;
}

/**
 * Slices for a list of ranges at canonical bounds. Shared by the
 * range->commentary and range->article query paths.
 */
export function slicesForRanges(ranges: ScriptureRange[]): PerekSlice[] {
	return rangesPerekSlices(ranges, canonicalPasukCount);
}

/**
 * SQL WHERE fragment matching verse-addressed rows inside the given
 * slices: every slice becomes an inclusive
 * `(perek_id = ? AND pasuk >= ? AND pasuk <= ?)` clause on the given
 * column alias, so boundary pesukim shared by two units appear in both.
 * Intra-pasuk segment bounds map onto their containing pasuk.
 */
function pasukSliceCondition(
	slices: PerekSlice[],
	alias: string,
): { sql: string; params: number[] } {
	const params: number[] = [];
	const clauses = slices.map((slice) => {
		params.push(slice.perekId, slice.startPasuk, slice.endPasuk);
		return `(${alias}.perek_id = ? AND ${alias}.pasuk >= ? AND ${alias}.pasuk <= ?)`;
	});
	return { sql: clauses.join(" OR "), params };
}

/**
 * SQL WHERE fragment matching note rows inside the given slices.
 * Verse-addressed commentary is pasuk-granular: boundary pesukim shared
 * by two units appear in both.
 */
export function noteSliceCondition(slices: PerekSlice[]): {
	sql: string;
	params: number[];
} {
	return pasukSliceCondition(slices, "n");
}

/**
 * SQL WHERE fragment matching tanah_article_covering_source rows inside
 * the given slices — the verified verse-level article coverage overlap
 * condition. Pasuk-granular like the commentary path: a covering row on
 * any pasuk inside the bounds selects the article.
 */
export function coveringSourceSliceCondition(slices: PerekSlice[]): {
	sql: string;
	params: number[];
} {
	return pasukSliceCondition(slices, "cs");
}

/**
 * Distinct perek ids covered by slices, in first-appearance order —
 * the article/perek-association query granularity.
 */
export function slicePerekIds(slices: PerekSlice[]): number[] {
	const seen = new Set<number>();
	for (const slice of slices) seen.add(slice.perekId);
	return [...seen];
}

/**
 * Rank of each perek by first appearance in slice order, so range
 * results can keep reading order across multi-range units (Haftarah
 * jumps may reach earlier perakim out of canonical order).
 */
export function slicePerekOrder(slices: PerekSlice[]): Map<number, number> {
	const order = new Map<number, number>();
	for (const slice of slices) {
		if (!order.has(slice.perekId)) order.set(slice.perekId, order.size);
	}
	return order;
}
