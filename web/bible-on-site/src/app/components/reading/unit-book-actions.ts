"use server";

import type { Pasuk } from "@/data/db/tanah-view-types";
import { getMasoraUnitById } from "@/data/masora/masora-units";
import {
	getParashaUnitById,
	parashaAuxiliaryRanges,
} from "@/data/parasha/parasha-units";
import { getPerekByPerekId, LAST_PEREK_ID } from "@/data/perek-dto";
import type { ArticleSummary } from "@/lib/articles";
import { getArticleSummariesForRangeGroups } from "@/lib/articles/service";
import {
	getPerushimForRangeGroups,
	getPerushNotesForRanges,
	type RangedPerushNote,
	type RangePerushSummary,
} from "@/lib/perushim";
import type { DivisionId, ScriptureRange } from "@/lib/reading/contract";
import type { UnitBookScope } from "./unit-book-content";
import {
	primeUnitSummaries,
	type UnitSummaryPair,
} from "./unit-summary-prefetch";

function unitScopeRanges(
	division: DivisionId,
	unitId: number,
	scope: UnitBookScope,
): ScriptureRange[] {
	const unit =
		division === "masora"
			? getMasoraUnitById(unitId)
			: division === "parasha"
				? getParashaUnitById(unitId)
				: /* istanbul ignore next -- defensive: callers pass only alternative divisions */ null;
	if (!unit) return [];
	return scope === "haftara" ? parashaAuxiliaryRanges(unit) : unit.ranges;
}

/** Articles + perushim summaries for one blank page's carousel pair. */
export interface UnitBookSummaries {
	articles: ArticleSummary[];
	perushim: RangePerushSummary[];
}

/**
 * Batch article/perushim summaries for the blank pages of an
 * alternative-division sefer book (issue #2191). Bounds resolve
 * server-side from the division data itself — the client names
 * division/unit/scope, never raw ranges — so every carousel stays
 * clipped to its parasha, and a Haftarah scope reaches the unit's
 * auxiliary readings instead of its Torah text.
 */
export async function getUnitScopeSummariesBatch(
	division: DivisionId,
	unitIds: number[],
	scope: UnitBookScope,
): Promise<Record<string, UnitBookSummaries>> {
	if (scope !== "torah" && scope !== "haftara") return {};
	const validIds = unitIds.filter(
		(unitId) => Number.isInteger(unitId) && unitId >= 1,
	);
	const rangeGroups = validIds.map((unitId) => {
		try {
			return unitScopeRanges(division, unitId, scope);
		} catch (error) {
			console.warn(
				"Failed to resolve %s unit %d %s ranges:",
				division,
				unitId,
				scope,
				error,
			);
			return [];
		}
	});
	// One grouped query per service for the whole sefer — a per-unit
	// fan-out over a 5-connection pool turned a large sefer's book open
	// into hundreds of serialized round-trips.
	let summaries: Record<string, UnitSummaryPair>;
	try {
		const [articleGroups, perushGroups] = await Promise.all([
			getArticleSummariesForRangeGroups(rangeGroups),
			getPerushimForRangeGroups(rangeGroups),
		]);
		summaries = Object.fromEntries(
			validIds.map((unitId, index) => [
				String(unitId),
				{
					articles: articleGroups[index] ?? [],
					perushim: perushGroups[index] ?? [],
				},
			]),
		);
	} catch (error) {
		console.warn(
			"Failed to resolve %s %s summaries batch:",
			division,
			scope,
			error instanceof Error ? error.message : error,
		);
		return Object.fromEntries(
			validIds.map((unitId) => [
				String(unitId),
				{ articles: [], perushim: [] },
			]),
		);
	}
	// Warm the flat unit pages' per-unit cache entries from the same
	// grouped results, so a later unit render reuses them instead of
	// re-querying (unit-summary-prefetch).
	primeUnitSummaries(division, scope, validIds, summaries);
	return summaries;
}

/**
 * Bounded commentary for a perush opened on an alternative-division
 * book's blank page. The canonical verse bounds resolve here from the
 * division data, so notes stay clipped to the selected parasha —
 * cross-perek parashot and separately scoped Haftarah sections
 * included — matching the flat unit page's bounds contract.
 */
export async function getUnitBookPerushNotes(
	division: DivisionId,
	unitId: number,
	scope: UnitBookScope,
	perushId: number,
): Promise<RangedPerushNote[]> {
	if (!Number.isInteger(perushId) || perushId < 1) return [];
	if (!Number.isInteger(unitId) || unitId < 1) return [];
	if (scope !== "torah" && scope !== "haftara") return [];
	try {
		const ranges = unitScopeRanges(division, unitId, scope);
		if (ranges.length === 0) return [];
		return await getPerushNotesForRanges(perushId, ranges);
	} catch (error) {
		console.warn(
			"Failed to resolve perush %d notes for %s unit %d scope %s:",
			perushId,
			division,
			unitId,
			scope,
			error instanceof Error ? error.message : error,
		);
		return [];
	}
}

/**
 * Range-scoped scripture for the פרשה sefer book's auxiliary (Haftarah)
 * readings — only the perakim the book actually renders, resolved from
 * the canonical corpus, instead of whole-sefer JSON downloads per
 * prophetic sefer the Haftarot touch.
 */
export async function getPerakimText(
	perekIds: number[],
): Promise<Record<number, { pesukim: Pasuk[] }>> {
	const result: Record<number, { pesukim: Pasuk[] }> = {};
	for (const perekId of new Set(perekIds.slice(0, LAST_PEREK_ID))) {
		if (!Number.isInteger(perekId) || perekId < 1 || perekId > LAST_PEREK_ID)
			continue;
		result[perekId] = { pesukim: getPerekByPerekId(perekId).pesukim };
	}
	return result;
}
