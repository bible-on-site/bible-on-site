export {
	getMoedArticleSummaries,
	getMoedBySlug,
	getPublishedMoadim,
	getPublishedMoedSlugs,
	MOED_STALE_BOUND_SECONDS,
} from "./service";
export type { Moed, MoedSection, MoedSummary } from "./types";
export {
	bandHue,
	bandRotation,
	buildMoedWheel,
	HEBREW_MONTHS,
	MONTH_HUES,
	monthKeyOf,
	OTHER_BAND_KEY,
	OTHER_BAND_LABEL,
	polar,
	sectorPath,
	spokeRotation,
	starOfDavidPath,
	wrapMoedName,
} from "./wheel";
export type { MoedWheel, WheelBand, WheelSlice } from "./wheel";

/** Public canonical root + per-moed href (#3101). */
export const MOADIM_ROOT = "/מועדים";
export const moedHref = (slug: string) => `${MOADIM_ROOT}/${slug}`;
