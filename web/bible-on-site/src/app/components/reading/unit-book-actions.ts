"use server";

import { getMasoraUnitById } from "@/data/masora/masora-units";
import {
	getParashaUnitById,
	parashaAuxiliaryRanges,
} from "@/data/parasha/parasha-units";
import { getArticleSummariesForRanges } from "@/lib/articles/service";
import {
	getPerushimForRanges,
	getPerushNotesForRanges,
	type RangePerushSummary,
	type RangedPerushNote,
} from "@/lib/perushim";
import type { ArticleSummary } from "@/lib/articles";
import type { DivisionId, ScriptureRange } from "@/lib/reading/contract";
import type { UnitBookScope } from "./unit-book-content";

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
	const entries = await Promise.all(
		unitIds.map(async (unitId) => {
			if (!Number.isInteger(unitId) || unitId < 1) return null;
			try {
				const ranges = unitScopeRanges(division, unitId, scope);
				if (ranges.length === 0) {
					return [String(unitId), { articles: [], perushim: [] }] as const;
				}
				const [articles, perushim] = await Promise.all([
					getArticleSummariesForRanges(ranges),
					getPerushimForRanges(ranges),
				]);
				return [String(unitId), { articles, perushim }] as const;
			} catch (error) {
				console.warn(
					"Failed to resolve %s unit %d %s summaries:",
					division,
					unitId,
					scope,
					error instanceof Error ? error.message : error,
				);
				return [String(unitId), { articles: [], perushim: [] }] as const;
			}
		}),
	);
	return Object.fromEntries(entries.filter((entry) => entry !== null));
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
