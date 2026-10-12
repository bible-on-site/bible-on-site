import { toLetters } from "gematry";
import type { Pasuk } from "@/data/db/tanah-view-types";
import type { ScriptureRange } from "@/lib/reading/contract";
import { type PerekSlice, rangesPerekSlices } from "@/lib/reading/ranges";
import { buildEntityRefLookup } from "@/lib/tanahpedia/entity-ref-lookup";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import perekStyles from "@/app/929/[number]/page.module.css";
import { renderPasukSegmentsWithEntityRefs } from "@/app/929/[number]/components/pasuk-renderer";
import { Ptuah } from "@/app/929/[number]/components/Ptuha";
import { Stuma } from "@/app/929/[number]/components/Stuma";
import { TanahpediaLink } from "@/app/929/[number]/components/TanahpediaLink";
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
}: {
	ranges: ScriptureRange[];
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
	pasukCount: (perekId: number) => number;
	resolvePerek: UnitTextPerekResolver;
	/** Suffix keeping anchor ids unique when several readings render the
	 * same canonical pasuk on one page (e.g. Haftarah variants whose
	 * ranges overlap). Canonical coordinates stay inside the id. */
	anchorScope?: string;
}) {
	const slices = rangesPerekSlices(ranges, pasukCount);
	const multiPerek = new Set(slices.map((slice) => slice.perekId)).size > 1;
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
					showPerekLabel={multiPerek}
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
}: {
	slice: PerekSlice;
	sliceIndex: number;
	firstSliceByCoord: Map<string, number>;
	anchorScope?: string;
	entityRefs: PerekEntityReference[];
	resolvePerek: UnitTextPerekResolver;
	showPerekLabel: boolean;
}) {
	const perek = resolvePerek(slice.perekId);
	if (!perek) return null;
	const entityRefLookup = buildEntityRefLookup(entityRefs);
	return (
		<>
			{showPerekLabel && (
				<span className={styles.perekBreakLabel}>{perek.source}</span>
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
					const emitsAnchor =
						firstSliceByCoord.get(`${slice.perekId}-${pasukNumber}`) ===
						sliceIndex;
					return (
						<span
							key={pasukNumber}
							id={
								emitsAnchor
									? `pasuk-${slice.perekId}-${pasukNumber}${anchorScope ? `-${anchorScope}` : ""}`
									: undefined
							}
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
