"use server";

import { unstable_cache } from "next/cache";
import { getMasoraUnitById } from "@/data/masora/masora-units";
import {
	getParashaUnitById,
	parashaAuxiliaryRanges,
} from "@/data/parasha/parasha-units";
import { getPerushNotesForRanges, type RangedPerushNote } from "@/lib/perushim";
import type { DivisionId, ScriptureRange } from "@/lib/reading/contract";
import type { UnitPerushScope } from "./unit-perush";

function unitRanges(
	division: DivisionId,
	unitId: number,
	scope: UnitPerushScope,
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

// Same shared "perushim" tag as the perek/range summary caches — a
// commentary data update invalidates bound notes everywhere at once.
const getCachedUnitPerushNotes = unstable_cache(
	async (
		division: DivisionId,
		unitId: number,
		scope: UnitPerushScope,
		perushId: number,
	): Promise<RangedPerushNote[]> => {
		const ranges = unitRanges(division, unitId, scope);
		if (ranges.length === 0) return [];
		return getPerushNotesForRanges(perushId, ranges);
	},
	["unit-perush-notes"],
	{ tags: ["perushim"], revalidate: false },
);

/**
 * Bounded commentary for a perush opened inside an alternative-division
 * page (issue #2190). The client names the division/unit/scope and the
 * perush id — the canonical verse bounds are resolved here from the
 * division data itself, never from client-supplied ranges — so notes
 * stay clipped to the selected parasha, including cross-perek parashot
 * and separately scoped Haftarah sections.
 */
export async function getUnitPerushNotes(
	division: DivisionId,
	unitId: number,
	scope: UnitPerushScope,
	perushId: number,
): Promise<RangedPerushNote[]> {
	if (!Number.isInteger(perushId) || perushId < 1) return [];
	if (!Number.isInteger(unitId) || unitId < 1) return [];
	if (scope !== "torah" && scope !== "haftara") return [];
	try {
		return await getCachedUnitPerushNotes(division, unitId, scope, perushId);
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
