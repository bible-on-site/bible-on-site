import { getMasoraUnitById } from "@/data/masora/masora-units";
import {
	getParashaUnitById,
	parashaAuxiliaryRanges,
} from "@/data/parasha/parasha-units";
import { getArticleSummariesForRanges } from "@/lib/articles/service";
import { getPerushimForRanges } from "@/lib/perushim";
import {
	cachedPerKey,
	COLLECTION_TAGS,
	masoraArticlesTag,
	masoraPerushimTag,
	parashaArticlesTag,
	parashaPerushimTag,
} from "@/lib/revalidate/tags";

type UnitSummaryScope = "torah" | "haftara";

/**
 * Shared per-unit range summary loaders, cached on the same keys the
 * flat unit pages warm — so a sefer book opening over N units reuses
 * the warm entry for the current unit and caches every other unit for
 * the flat pages' later renders, instead of a second uncached fan-out.
 */
export const getParashaRangePerushim = cachedPerKey(
	"parasha-range-perushim",
	(unitId: number, scope: UnitSummaryScope) => `${unitId}:${scope}`,
	(key) => {
		const [unitId, scope] = key.split(":");
		return [
			COLLECTION_TAGS.perushim,
			parashaPerushimTag(Number(unitId), scope),
		];
	},
	async (unitId: number, scope: UnitSummaryScope) => {
		const unit = getParashaUnitById(unitId);
		const ranges =
			scope === "haftara" ? parashaAuxiliaryRanges(unit) : unit.ranges;
		return getPerushimForRanges(ranges);
	},
);

export const getParashaRangeArticles = cachedPerKey(
	"parasha-range-article-summaries",
	(unitId: number, scope: UnitSummaryScope) => `${unitId}:${scope}`,
	(key) => {
		const [unitId, scope] = key.split(":");
		return [
			COLLECTION_TAGS.articles,
			parashaArticlesTag(Number(unitId), scope),
		];
	},
	async (unitId: number, scope: UnitSummaryScope) => {
		const unit = getParashaUnitById(unitId);
		const ranges =
			scope === "haftara" ? parashaAuxiliaryRanges(unit) : unit.ranges;
		return getArticleSummariesForRanges(ranges);
	},
);

export const getMasoraRangePerushim = cachedPerKey(
	"range-perushim",
	(unitId: number) => String(unitId),
	(key) => [COLLECTION_TAGS.perushim, masoraPerushimTag(Number(key))],
	async (unitId: number) =>
		getPerushimForRanges(getMasoraUnitById(unitId).ranges),
);

export const getMasoraRangeArticles = cachedPerKey(
	"range-article-summaries",
	(unitId: number) => String(unitId),
	(key) => [COLLECTION_TAGS.articles, masoraArticlesTag(Number(key))],
	async (unitId: number) =>
		getArticleSummariesForRanges(getMasoraUnitById(unitId).ranges),
);

