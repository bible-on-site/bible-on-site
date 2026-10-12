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
import { ScrollToUnitPasuk } from "./ScrollToUnitPasuk";

/**
 * Renders a reading unit's scripture text — the shared range resolver's
 * presentation half. The unit's ranges decompose into per-perek slices;
 * each slice renders only its included pesukim, clipped at segment level
 * when a boundary cuts inside a pasuk (מסורה breaks may sit mid-verse).
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
	// Primary ranges carry the unit's own text; auxiliary readings (e.g.
	// Haftarot) render in their own section and are excluded here.
	const slices = rangesPerekSlices(unit.ranges, masoraPasukCount);
	// Verse-position numbering: each rendered pasuk row counts one
	// position, so the first pasuk of every slice continues the running
	// parasha sequence rather than restarting a chapter count.
	const firstPositions: number[] = [];
	let renderedCount = 0;
	for (const slice of slices) {
		firstPositions.push(renderedCount + 1);
		renderedCount += slice.endPasuk - slice.startPasuk + 1;
	}
	return (
		<article className={perekStyles.perekText} data-unit-text>
			<Suspense>
				<ScrollToUnitPasuk />
			</Suspense>
			{slices.map((slice, index) => (
				<UnitPerekSlice
					key={`${slice.perekId}-${slice.startPasuk}`}
					slice={slice}
					entityRefs={entityRefsByPerek[slice.perekId] ?? []}
					firstPosition={firstPositions[index]}
				/>
			))}
		</article>
	);
}

function UnitPerekSlice({
	slice,
	entityRefs,
	firstPosition,
}: {
	slice: PerekSlice;
	entityRefs: PerekEntityReference[];
	firstPosition: number;
}) {
	const perekObj = getPerekByPerekId(slice.perekId);
	const entityRefLookup = buildEntityRefLookup(entityRefs);
	return (
		<>
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
					// A segment-clipped boundary pasuk reads as a partial
					// verse inside the parasha; the marker says so.
					const position = toLetters(firstPosition + offset);
					const startsMidVerse =
						pasukNumber === slice.startPasuk &&
						slice.startSegmentIndex !== undefined;
					const endsMidVerse =
						pasukNumber === slice.endPasuk &&
						slice.endSegmentIndex !== undefined;
					const marker =
						startsMidVerse && endsMidVerse
							? `${position} (קטע)`
							: startsMidVerse
								? `${position} (התחלה)`
								: endsMidVerse
									? `${position} (סיום)`
									: position;
					return (
						<span
							key={pasukNumber}
							id={`pasuk-${slice.perekId}-${pasukNumber}`}
						>
							<span className={perekStyles.pasukNum}>{marker}</span>{" "}
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
