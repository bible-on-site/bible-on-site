import { toLetters } from "gematry";
import { Suspense } from "react";
import { getPerekByPerekId } from "@/data/perek-dto";
import type { ReadingUnit } from "@/lib/reading/contract";
import { type PerekSlice, rangesPerekSlices } from "@/lib/reading/ranges";
import { buildEntityRefLookup } from "@/lib/tanahpedia/entity-ref-lookup";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import perekStyles from "@/app/929/[number]/page.module.css";
import { renderPasukSegmentsWithEntityRefs } from "@/app/929/[number]/components/pasuk-renderer";
import { Ptuah } from "@/app/929/[number]/components/Ptuha";
import { Stuma } from "@/app/929/[number]/components/Stuma";
import { TanahpediaLink } from "@/app/929/[number]/components/TanahpediaLink";
import { masoraPasukCount } from "@/data/masora/masora-units";
import styles from "../page.module.css";
import { ScrollToUnitPasuk } from "./ScrollToUnitPasuk";

/**
 * Renders a reading unit's scripture text — the shared range resolver's
 * presentation half. The unit's ranges decompose into per-perek slices;
 * each slice renders only its included pesukim, clipped at segment level
 * when a boundary cuts inside a pasuk (מסורה breaks may sit mid-verse).
 * Pasuk anchors keep canonical coordinates (`pasuk-{perekId}-{pasuk}`)
 * so a unit crossing perakim still addresses original verses.
 */
export function UnitText({
	unit,
	entityRefsByPerek,
}: {
	unit: ReadingUnit;
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
}) {
	// Primary ranges carry the unit's own text; auxiliary readings (e.g.
	// Haftarot) render in their own section and are excluded here.
	const slices = rangesPerekSlices(unit.ranges, masoraPasukCount);
	const multiPerek =
		new Set(slices.map((slice) => slice.perekId)).size > 1;
	return (
		<article className={perekStyles.perekText} data-unit-text>
			<Suspense>
				<ScrollToUnitPasuk />
			</Suspense>
			{slices.map((slice) => (
				<UnitPerekSlice
					key={`${slice.perekId}-${slice.startPasuk}`}
					slice={slice}
					entityRefs={entityRefsByPerek[slice.perekId] ?? []}
					showPerekLabel={multiPerek}
				/>
			))}
		</article>
	);
}

function UnitPerekSlice({
	slice,
	entityRefs,
	showPerekLabel,
}: {
	slice: PerekSlice;
	entityRefs: PerekEntityReference[];
	showPerekLabel: boolean;
}) {
	const perekObj = getPerekByPerekId(slice.perekId);
	const entityRefLookup = buildEntityRefLookup(entityRefs);
	return (
		<>
			{showPerekLabel && (
				<span className={styles.perekBreakLabel}>{perekObj.source}</span>
			)}
			{perekObj.pesukim
				.slice(slice.startPasuk - 1, slice.endPasuk)
				.map((pasuk, offset) => {
					const pasukNumber = slice.startPasuk + offset;
					const startIdx =
						pasukNumber === slice.startPasuk
							? (slice.startSegmentIndex ?? 0)
							: 0;
					const endIdx =
						pasukNumber === slice.endPasuk
							? (slice.endSegmentIndex ?? pasuk.segments.length - 1)
							: pasuk.segments.length - 1;
					const pasukIdx = pasukNumber - 1;
					return (
						<span
							key={pasukNumber}
							id={`pasuk-${slice.perekId}-${pasukNumber}`}
						>
							<span className={perekStyles.pasukNum}>
								{toLetters(pasukNumber)}
							</span>{" "}
							{renderPasukSegmentsWithEntityRefs(
								pasuk.segments,
								pasukIdx,
								startIdx,
								endIdx,
								entityRefLookup,
								Ptuah,
								Stuma,
								perekStyles.qri,
								(entryUniqueName, children, key) => (
									<TanahpediaLink
										key={key}
										entryUniqueName={entryUniqueName}
										className={perekStyles.tanahpediaLink}
									>
										{children}
									</TanahpediaLink>
								),
							)}{" "}
						</span>
					);
				})}
		</>
	);
}
