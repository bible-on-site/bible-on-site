import {
	moedDateCarriesMonth,
	moedDateLine,
	type MoedSummary,
} from "@/lib/moadim";

/** The two stored date fields every moed date display derives from. */
type MoedDate = Pick<MoedSummary, "hebrewMonth" | "dateLabel">;

/**
 * Detail-header date line — when the date label already carries the
 * month it renders alone (no repeated month beside it, #3381); a
 * month-only or day-only date still renders; a moed with no stored
 * date content renders nothing at all.
 */
export function MoedDateLine({
	moed,
	className,
}: {
	moed: MoedDate;
	className?: string;
}) {
	const line = moedDateLine(moed);
	if (line == null) return null;
	return <p className={className}>{line}</p>;
}

/**
 * Catalogue month chip — information, not decoration: it renders only
 * when the stored date label does not already name the month (#3381).
 */
export function MoedMonthChip({
	moed,
	className,
}: {
	moed: MoedDate;
	className?: string;
}) {
	if (moed.hebrewMonth == null || moed.hebrewMonth === "") return null;
	if (moedDateCarriesMonth(moed)) return null;
	return <span className={className}>{moed.hebrewMonth}</span>;
}
