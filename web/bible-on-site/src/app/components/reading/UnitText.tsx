import { Suspense } from "react";
import perekStyles from "@/app/929/[number]/page.module.css";
import { getPerekByPerekId } from "@/data/perek-dto";
import type { ScriptureRange } from "@/lib/reading/contract";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import { ScrollToUnitPasuk } from "./ScrollToUnitPasuk";
import { UnitTextBody } from "./UnitTextBody";

/**
 * Renders an ordered range list's scripture text — the shared range
 * resolver's presentation half. Ranges decompose into per-perek slices;
 * each slice renders only its included pesukim, clipped at segment
 * level when a boundary cuts inside a pasuk (מסורה breaks may sit
 * mid-verse). Pasuk anchors keep canonical coordinates
 * (`pasuk-{perekId}-{pasuk}`) so a reading crossing perakim or sefarim
 * still addresses original verses. `scrollScope` distinguishes
 * co-rendered articles (Torah text vs. Haftarah variants) so the hash
 * scroller highlights inside the right one.
 */
export function SharedUnitText({
	ranges,
	entityRefsByPerek,
	pasukCount,
	scrollScope = "",
	anchorScope,
	unitPositionMarkers,
}: {
	ranges: ScriptureRange[];
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
	pasukCount: (perekId: number) => number;
	scrollScope?: string;
	/** Optional anchor-id suffix for co-rendered auxiliary readings whose
	 * ranges overlap another article's pesukim — the hash scroller falls
	 * back to the scoped id inside the matching article. */
	anchorScope?: string;
	/** Forwarded to UnitTextBody — parasha-position markers and no perek
	 * chrome, for division readers that hide conventional chapter
	 * apparatus. */
	unitPositionMarkers?: boolean;
}) {
	return (
		<article className={perekStyles.perekText} data-unit-text={scrollScope}>
			<Suspense>
				<ScrollToUnitPasuk scope={scrollScope} />
			</Suspense>
			<UnitTextBody
				ranges={ranges}
				entityRefsByPerek={entityRefsByPerek}
				pasukCount={pasukCount}
				anchorScope={anchorScope}
				unitPositionMarkers={unitPositionMarkers}
				resolvePerek={(perekId) => {
					const perek = getPerekByPerekId(perekId);
					return perek
						? { pesukim: perek.pesukim, source: perek.source }
						: undefined;
				}}
			/>
		</article>
	);
}
