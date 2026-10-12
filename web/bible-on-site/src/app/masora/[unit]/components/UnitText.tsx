import { SharedUnitText } from "@/app/components/reading/UnitText";
import { masoraPasukCount } from "@/data/masora/masora-units";
import type { ReadingUnit } from "@/lib/reading/contract";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";

/**
 * Renders a מסורה unit's scripture text — the shared range resolver's
 * presentation half. Primary ranges carry the unit's own text;
 * auxiliary readings (e.g. Haftarot) are excluded here by contract.
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
		/>
	);
}
