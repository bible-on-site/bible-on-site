export {
	getMoedArticleSummaries,
	getMoedBySlug,
	getPublishedMoadim,
	getPublishedMoedSlugs,
	MOED_STALE_BOUND_SECONDS,
} from "./service";
export type { Moed, MoedSection, MoedSummary } from "./types";

/** Public canonical root + per-moed href (#3101). */
export const MOADIM_ROOT = "/מועדים";
export const moedHref = (slug: string) => `${MOADIM_ROOT}/${slug}`;
