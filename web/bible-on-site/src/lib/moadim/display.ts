import type { MoedSummary } from "./types";

/** The two stored date fields every date display derives from. */
type MoedDate = Pick<MoedSummary, "hebrewMonth" | "dateLabel">;

/**
 * Whether the stored date label already names the stored month — for
 * example `ג' בתשרי` carries `תשרי`. Surfaces must not repeat the month
 * beside such a date (#3381); the field itself still feeds the wheel's
 * month-band grouping and position, which is not a display concern.
 */
export function moedDateCarriesMonth(moed: MoedDate): boolean {
	// An empty month or date would make `includes("")` trivially true —
	// only a non-empty pair can carry the month.
	return (
		moed.hebrewMonth != null &&
		moed.hebrewMonth !== "" &&
		moed.dateLabel != null &&
		moed.dateLabel !== "" &&
		moed.dateLabel.includes(moed.hebrewMonth)
	);
}

/**
 * The complete date line for the detail header and catalogue index.
 * When the date label already carries the month it renders alone;
 * otherwise the standalone month precedes it — so a multi-day range
 * (`א'-ב' בתשרי`) and a month-less date both stay intact. `null` when
 * neither field has content, letting the caller omit the line entirely.
 */
export function moedDateLine(moed: MoedDate): string | null {
	if (moedDateCarriesMonth(moed)) return moed.dateLabel;
	const parts = [moed.hebrewMonth, moed.dateLabel].filter(
		(part): part is string => part != null && part !== "",
	);
	return parts.length > 0 ? parts.join(" · ") : null;
}
