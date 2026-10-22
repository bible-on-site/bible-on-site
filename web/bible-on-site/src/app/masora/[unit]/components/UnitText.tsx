import { SharedUnitText } from "@/app/components/reading/UnitText";
import { masoraPasukCount } from "@/data/masora/masora-units";
import type { ReadingUnit } from "@/lib/reading/contract";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";

/**
 * Renders a מסורה unit's scripture text — the shared range resolver's
 * presentation half. Primary ranges carry the unit's own text;
 * auxiliary readings (e.g. Haftarot) are excluded here by contract.
 *
 * Conventional chapter chrome stays out of the מסורה reader: no perek
 * break dividers and no chapter-relative verse numbers. Instead each
 * rendered pasuk carries its position inside the parasha — a continuous
 * 1-based count across the unit's slices, so a parasha crossing perakim
 * keeps one unbroken sequence. A boundary-clipped partial pasuk still
 * occupies its own position; its marker carries a suffix — `(התחלה)`
 * when the parasha opens mid-verse, `(סיום)` when it closes mid-verse,
 * `(קטע)` for a lone excerpt. Pasuk anchors keep canonical coordinates
 * (`pasuk-{perekId}-{pasuk}`) so a unit crossing perakim still addresses
 * original verses.
 */
export function UnitText({
	unit,
	entityRefsByPerek,
}: {
	unit: ReadingUnit;
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
}) {
	return (
		<SharedUnitText
			ranges={unit.ranges}
			entityRefsByPerek={entityRefsByPerek}
			pasukCount={masoraPasukCount}
			unitPositionMarkers
		/>
	);
}
