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
import {
	getCachedMasoraRangeArticles,
	getCachedMasoraRangePerushim,
	getCachedParashaRangeArticles,
	getCachedParashaRangePerushim,
} from "@/lib/reading/cached-range-summaries";
import type { ArticleSummary } from "@/lib/articles";
import type { DivisionId, ScriptureRange } from "@/lib/reading/contract";
import type { UnitBookScope } from "./unit-book-content";

// A cold sefer still resolves ~2 queries per unit; chunking caps how many
// of those queue on the pool at once instead of bursting all units at once.
const UNIT_BATCH_CONCURRENCY = 8;

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
	const loadUnit = async (
		unitId: number,
	): Promise<[string, UnitBookSummaries] | null> => {
		if (!Number.isInteger(unitId) || unitId < 1) return null;
		try {
			const ranges = unitScopeRanges(division, unitId, scope);
			if (ranges.length === 0) {
				return [String(unitId), { articles: [], perushim: [] }];
			}
			// The cached fetchers share entries with the flat unit pages, so a
			// book open only queries for units nobody has visited yet.
			const [articles, perushim] =
				division === "parasha"
					? await Promise.all([
							getCachedParashaRangeArticles(unitId, scope),
							getCachedParashaRangePerushim(unitId, scope),
						])
					: division === "masora" && scope === "torah"
						? await Promise.all([
								getCachedMasoraRangeArticles(unitId),
								getCachedMasoraRangePerushim(unitId),
							])
						: await Promise.all([
								getArticleSummariesForRanges(ranges),
								getPerushimForRanges(ranges),
							]);
			return [String(unitId), { articles, perushim }];
		} catch (error) {
			console.warn(
				"Failed to resolve %s unit %d %s summaries:",
				division,
				unitId,
				scope,
				error instanceof Error ? error.message : error,
			);
			return [String(unitId), { articles: [], perushim: [] }];
		}
	};
	const entries: ([string, UnitBookSummaries] | null)[] = [];
	for (let i = 0; i < unitIds.length; i += UNIT_BATCH_CONCURRENCY) {
		entries.push(
			...(await Promise.all(
				unitIds.slice(i, i + UNIT_BATCH_CONCURRENCY).map(loadUnit),
			)),
		);
	}
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
