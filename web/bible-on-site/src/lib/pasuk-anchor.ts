/**
 * Verse-citation hash anchors: `#pasuk-<pasuk>` on flat perek pages and
 * `#pasuk-<perekId>-<pasuk>` in ranged/unit views (RangedPerushView links,
 * canonical unit-text ids). A reader landing on one stays in the text view,
 * so the stored book-view preference is not auto-applied.
 */
export function isPasukCitationHash(hash: string): boolean {
	return /^#pasuk-[1-9]\d*(?:-[1-9]\d*)?$/.test(hash);
}
