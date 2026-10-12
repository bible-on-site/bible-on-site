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
 * Derived-table SELECT list numbering each slice by its supplied-order
 * ordinal — the rank basis for range->article ORDER BY. Slice ordinals
 * are loop indices, safe to inline; slice bounds stay parameterized
 * (three params per slice, matching coveringSourceSliceCondition).
 */
function sliceOrdinalSelects(slices: PerekSlice[]): {
	sql: string;
	params: number[];
} {
	const params: number[] = [];
	const selects = slices.map((slice, index) => {
		params.push(slice.perekId, slice.startPasuk, slice.endPasuk);
		return `SELECT ${index} AS slice_order, ? AS perek_id, ? AS start_pasuk, ? AS end_pasuk`;
	});
	return { sql: selects.join(" UNION ALL "), params };
}

/**
 * Scalar rank expression giving each article row the ordinal of its
 * FIRST matching slice in supplied range order — reading order for
 * multi-range units (a Haftarah may reach a later perek before an
 * earlier one). A verified article matches a slice when one of its
 * tanah_article_covering_source rows lands inside the slice; an
 * unverified article matches the slices on its primary perek — the
 * same match semantics as the WHERE clause it accompanies, so MIN
 * never yields NULL for a returned row. One row per article is
 * retained: the scalar subquery feeds ORDER BY, not a join.
 */
export function coveringSourceSliceRank(slices: PerekSlice[]): {
	sql: string;
	params: number[];
} {
	const slicesTable = sliceOrdinalSelects(slices);
	const sql =
		"(SELECT MIN(slice_match.slice_order) " +
		`FROM (${slicesTable.sql}) slice_match ` +
		"WHERE (a.coverage_verified = TRUE AND EXISTS (" +
		"SELECT 1 FROM tanah_article_covering_source cs " +
		"WHERE cs.article_id = a.id AND cs.perek_id = slice_match.perek_id " +
		"AND cs.pasuk BETWEEN slice_match.start_pasuk AND slice_match.end_pasuk)) " +
		"OR (a.coverage_verified = FALSE AND a.perek_id = slice_match.perek_id))";
	return { sql, params: slicesTable.params };
}

/**
 * Pre-upgrade-schema rank companion to coveringSourceSliceRank for the
 * pre-migration fallback in getArticleSummariesForRanges: without
 * covering-source data every article matches through its primary
 * perek, so the first slice on that perek gives the rank. References
 * neither coverage_verified nor the covering-source table.
 */
export function primaryPerekSliceRank(slices: PerekSlice[]): {
	sql: string;
	params: number[];
} {
	const slicesTable = sliceOrdinalSelects(slices);
	const sql =
		"(SELECT MIN(slice_match.slice_order) " +
		`FROM (${slicesTable.sql}) slice_match ` +
		"WHERE a.perek_id = slice_match.perek_id)";
	return { sql, params: slicesTable.params };
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
