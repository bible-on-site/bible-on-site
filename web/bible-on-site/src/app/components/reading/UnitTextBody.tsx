import { toLetters } from "gematry";
import { Ptuah } from "@/app/929/[number]/components/Ptuha";
import { renderPasukSegmentsWithEntityRefs } from "@/app/929/[number]/components/pasuk-renderer";
import { Stuma } from "@/app/929/[number]/components/Stuma";
import { TanahpediaLink } from "@/app/929/[number]/components/TanahpediaLink";
import perekStyles from "@/app/929/[number]/page.module.css";
import type { Pasuk } from "@/data/db/tanah-view-types";
import type { ScriptureRange } from "@/lib/reading/contract";
import { type PerekSlice, rangesPerekSlices } from "@/lib/reading/ranges";
import { buildEntityRefLookup } from "@/lib/tanahpedia/entity-ref-lookup";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import styles from "./reading-unit-text.module.css";

/** The slice of canonical perek data the renderer needs. */
export interface UnitTextPerek {
	pesukim: Pasuk[];
	/** Display label used on perek-boundary breaks (e.g. `בראשית ג`). */
	source: string;
}

export type UnitTextPerekResolver = (
	perekId: number,
) => UnitTextPerek | undefined;

/**
 * A boundary marker rendered inline before a pasuk — e.g. an aliyah
 * start (issue #2519). `key` identifies which reading/scheme layer
 * owns the marker: callers may embed several layers in one text and
 * reveal exactly one at a time, so scheme/context switching never
 * remounts scripture.
 */
export interface UnitBoundaryMarker {
	key: string;
	label: string;
	role?: "aliyah" | "maftir";
}

/**
 * Resolver-injected scripture renderer for ordered ranges — the part of
 * the shared range text that stays client-safe: no canonical-corpus
 * import, so the פרשה sefer book can render ranges over lazily loaded
 * sefer JSON while the SSG flat pages resolve against the corpus.
 * Pasuk anchors keep canonical coordinates (`pasuk-{perekId}-{pasuk}`),
 * range order is preserved (Haftarah jumps and repeated pesukim render
 * in declared order), and segment bounds clip mid-pasuk edges.
 */
export function UnitTextBody({
	ranges,
	entityRefsByPerek,
	pasukCount,
	resolvePerek,
	anchorScope,
	unitPositionMarkers,
	boundaryMarkers,
	defaultMarkerKey,
	modestPerekLabels,
}: {
	ranges: ScriptureRange[];
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
	pasukCount: (perekId: number) => number;
	resolvePerek: UnitTextPerekResolver;
	/** Suffix keeping anchor ids unique when several readings render the
	 * same canonical pasuk on one page (e.g. Haftarah variants whose
	 * ranges overlap). Canonical coordinates stay inside the id. */
	anchorScope?: string;
	/** Renders each pasuk's position inside the unit (1-based, continuous
	 * across slices) instead of its canonical perek-relative number, and
	 * drops perek-break labels — the alternative-division chrome where
	 * conventional chapter apparatus stays hidden. Boundary-clipped
	 * pesukim still count a position and carry a התחלה/סיום/קטע suffix. */
	unitPositionMarkers?: boolean;
	/** Boundary markers keyed `"{perekId}:{pasuk}"` — each coordinate may
	 * hold several (one per reading context/scheme layer); only markers
	 * matching `defaultMarkerKey` render visible. When provided, perek
	 * breaks demote to the modest pasuk-like label so the boundary
	 * markers own the prominent separator treatment. */
	boundaryMarkers?: ReadonlyMap<string, readonly UnitBoundaryMarker[]>;
	defaultMarkerKey?: string;
	/** Demotes perek-break labels to the modest pasuk-like style even
	 * where no boundary markers exist — e.g. the parasha reader's
	 * Haftarah text, which shares the page with an annotated Torah
	 * reading (issue #2519). */
	modestPerekLabels?: boolean;
}) {
	const slices = rangesPerekSlices(ranges, pasukCount);
	const multiPerek = new Set(slices.map((slice) => slice.perekId)).size > 1;
	// Verse-position numbering: each rendered pasuk row counts one
	// position, so the first pasuk of every slice continues the running
	// parasha sequence rather than restarting a chapter count.
	const firstPositions: number[] = [];
	let renderedCount = 0;
	for (const slice of slices) {
		firstPositions.push(renderedCount + 1);
		renderedCount += slice.endPasuk - slice.startPasuk + 1;
	}
	// Only a coordinate's first slice emits its anchor id — an
	// intentionally repeated pasuk renders text again, not a second id.
	const firstSliceByCoord = new Map<string, number>();
	slices.forEach((slice, index) => {
		for (let pasuk = slice.startPasuk; pasuk <= slice.endPasuk; pasuk++) {
			const coord = `${slice.perekId}-${pasuk}`;
			if (!firstSliceByCoord.has(coord)) firstSliceByCoord.set(coord, index);
		}
	});
	return (
		<>
			{slices.map((slice, sliceIndex) => (
				<UnitPerekSlice
					key={`${slice.rangeIndex}-${slice.perekId}-${slice.startPasuk}`}
					slice={slice}
					sliceIndex={sliceIndex}
					firstSliceByCoord={firstSliceByCoord}
					anchorScope={anchorScope}
					entityRefs={entityRefsByPerek[slice.perekId] ?? []}
					resolvePerek={resolvePerek}
					showPerekLabel={multiPerek && !unitPositionMarkers}
					modestPerekLabel={modestPerekLabels || boundaryMarkers != null}
					boundaryMarkers={boundaryMarkers}
					defaultMarkerKey={defaultMarkerKey}
					firstPosition={
						unitPositionMarkers ? firstPositions[sliceIndex] : undefined
					}
				/>
			))}
		</>
	);
}

function UnitPerekSlice({
	slice,
	sliceIndex,
	firstSliceByCoord,
	anchorScope,
	entityRefs,
	resolvePerek,
	showPerekLabel,
	modestPerekLabel,
	boundaryMarkers,
	defaultMarkerKey,
	firstPosition,
}: {
	slice: PerekSlice;
	sliceIndex: number;
	firstSliceByCoord: Map<string, number>;
	anchorScope?: string;
	entityRefs: PerekEntityReference[];
	resolvePerek: UnitTextPerekResolver;
	showPerekLabel: boolean;
	modestPerekLabel?: boolean;
	boundaryMarkers?: ReadonlyMap<string, readonly UnitBoundaryMarker[]>;
	defaultMarkerKey?: string;
	firstPosition?: number;
}) {
	const perek = resolvePerek(slice.perekId);
	if (!perek) return null;
	const entityRefLookup = buildEntityRefLookup(entityRefs);
	return (
		<>
			{showPerekLabel && (
				<span
					className={
						modestPerekLabel
							? styles.perekBreakLabelModest
							: styles.perekBreakLabel
					}
				>
					{perek.source}
				</span>
			)}
			{perek.pesukim
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
					// A boundary pasuk reads as a partial verse inside the
					// unit only when the bound actually omits segments: a
					// break marker sitting on the pasuk's last segment (or a
					// unit opening at its first) leaves the whole verse
					// inside, so the position stays unmarked.
					const marker = (() => {
						if (firstPosition == null) return toLetters(pasukNumber);
						const position = toLetters(firstPosition + offset);
						const startsMidVerse =
							pasukNumber === slice.startPasuk && startIdx > 0;
						const endsMidVerse =
							pasukNumber === slice.endPasuk &&
							endIdx < pasuk.segments.length - 1;
						return startsMidVerse && endsMidVerse
							? `${position} (קטע)`
							: startsMidVerse
								? `${position} (התחלה)`
								: endsMidVerse
									? `${position} (סיום)`
									: position;
					})();
					const emitsAnchor =
						firstSliceByCoord.get(`${slice.perekId}-${pasukNumber}`) ===
						sliceIndex;
					const boundary =
						boundaryMarkers?.get(`${slice.perekId}:${pasukNumber}`) ?? [];
					return (
						<span
							key={pasukNumber}
							id={
								emitsAnchor
									? `pasuk-${slice.perekId}-${pasukNumber}${anchorScope ? `-${anchorScope}` : ""}`
									: undefined
							}
						>
							{boundary.map((mark) => (
								<span
									key={mark.key}
									className={styles.aliyahBreakLabel}
									data-aliyah-marker=""
									data-aliyah-key={mark.key}
									data-aliyah-role={mark.role}
									hidden={mark.key !== defaultMarkerKey}
								>
									{mark.label}
								</span>
							))}
							<span className={perekStyles.pasukNum} data-pasuk-num>
								{marker}
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
