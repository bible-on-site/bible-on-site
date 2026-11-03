/**
 * Per-unit range summary caches shared by the flat unit pages and the
 * sefer book views. One definition per (division, scope) keeps the cache
 * entries shared: a book open reuses whatever the flat page warmed, and
 * re-opens hit the same entries instead of re-issuing the unit fan-out.
 */
import { getMasoraUnitById } from "@/data/masora/masora-units";
import {
	getParashaUnitById,
	parashaAuxiliaryRanges,
} from "@/data/parasha/parasha-units";
import { getArticleSummariesForRanges } from "@/lib/articles/service";
import { getPerushimForRanges } from "@/lib/perushim/service";
import {
	cachedPerKey,
	COLLECTION_TAGS,
	masoraArticlesTag,
	masoraPerushimTag,
	parashaArticlesTag,
	parashaPerushimTag,
} from "@/lib/revalidate/tags";

export type UnitRangeScope = "torah" | "haftara";

export const getCachedMasoraRangePerushim = cachedPerKey(
	"range-perushim",
	(unitId: number) => String(unitId),
	(key) => [COLLECTION_TAGS.perushim, masoraPerushimTag(Number(key))],
	async (unitId: number) => {
		const unit = getMasoraUnitById(unitId);
		return getPerushimForRanges(unit.ranges);
	},
);

export const getCachedMasoraRangeArticles = cachedPerKey(
	"range-article-summaries",
	(unitId: number) => String(unitId),
	(key) => [COLLECTION_TAGS.articles, masoraArticlesTag(Number(key))],
	async (unitId: number) => {
		const unit = getMasoraUnitById(unitId);
		return getArticleSummariesForRanges(unit.ranges);
	},
);

export const getCachedParashaRangePerushim = cachedPerKey(
	"parasha-range-perushim",
	(unitId: number, scope: UnitRangeScope) => `${unitId}:${scope}`,
	(key) => {
		const [unitId, scope] = key.split(":");
		return [COLLECTION_TAGS.perushim, parashaPerushimTag(Number(unitId), scope)];
	},
	async (unitId: number, scope: UnitRangeScope) => {
		const unit = getParashaUnitById(unitId);
		const ranges =
			scope === "haftara" ? parashaAuxiliaryRanges(unit) : unit.ranges;
		return getPerushimForRanges(ranges);
	},
);

export const getCachedParashaRangeArticles = cachedPerKey(
	"parasha-range-article-summaries",
	(unitId: number, scope: UnitRangeScope) => `${unitId}:${scope}`,
	(key) => {
		const [unitId, scope] = key.split(":");
		return [COLLECTION_TAGS.articles, parashaArticlesTag(Number(unitId), scope)];
	},
	async (unitId: number, scope: UnitRangeScope) => {
		const unit = getParashaUnitById(unitId);
		const ranges =
			scope === "haftara" ? parashaAuxiliaryRanges(unit) : unit.ranges;
		return getArticleSummariesForRanges(ranges);
	},
);
