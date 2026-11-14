import { Ptuah } from "@/app/929/[number]/components/Ptuha";
import {
	RecitationLink,
	RecitationWordControl,
} from "@/app/929/[number]/components/RecitationPlayer";
import { Stuma } from "@/app/929/[number]/components/Stuma";
import { TanahpediaLink } from "@/app/929/[number]/components/TanahpediaLink";
import { renderPasukSegmentsWithEntityRefs } from "@/app/929/[number]/components/pasuk-renderer";
import perekStyles from "@/app/929/[number]/page.module.css";
import type { Pasuk } from "@/data/db/tanah-view-types";
import type { ScriptureRange } from "@/lib/reading/contract";
import { type PerekSlice, rangesPerekSlices } from "@/lib/reading/ranges";
import { buildEntityRefLookup } from "@/lib/tanahpedia/entity-ref-lookup";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import { toLetters } from "gematry";
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
 * Coincident markers that agree on the boundary — same ordinal and
 * role — merge into one pill (issue #3165 review): their tag lists the
 * shared schemes/contexts (`שבת+חול`), while variant communities that
 * agree with the common division fold silently into the joined detail.
 * Only a genuinely divergent division — a community re-slicing the
 * ordinal at another coordinate, or a different ordinal at this one —
 * keeps its own tagged marker. `data-aliyah-key` carries every
 * constituent layer key space-separated, so emphasis of any merged
 * layer highlights the shared pill.
 */
function mergeBoundaryMarkers(
	markers: readonly UnitBoundaryMarker[],
): UnitBoundaryMarker[] {
	const groups = new Map<string, UnitBoundaryMarker[]>();
	for (const mark of markers) {
		const groupKey = `${mark.label}${mark.role ?? "aliyah"}`;
		const group = groups.get(groupKey) ?? [];
		groups.set(groupKey, group);
		group.push(mark);
	}
	return [...groups.values()].map((group) => {
		if (group.length === 1) return group[0];
		// Agreeing variant/custom layers keep the merged detail but add
		// no tag of their own — only the shared schemes/contexts show.
		const nonVariant = group.filter((mark) => mark.category !== "variant");
		const tags = new Set(
			(nonVariant.length > 0 ? nonVariant : group)
				.map((mark) => mark.tag)
				.filter((tag): tag is string => Boolean(tag)),
		);
		const category =
			new Set(group.map((mark) => mark.category)).size === 1
				? group[0].category
				: "shared";
		return {
			key: group.map((mark) => mark.key).join(" "),
			label: group[0].label,
			role: group[0].role,
			tag: [...tags].join("+"),
			category,
			detail: group
				.map(
					(mark) =>
						mark.detail ?? [mark.tag, mark.label].filter(Boolean).join(" "),
				)
				.join("\n"),
		};
	});
}

/**
 * A boundary marker rendered inline before a pasuk — e.g. an aliyah
 * start (issue #2519). `key` identifies which reading/scheme layer
 * owns the marker. Since issue #3165 every applicable layer renders
 * together inline at its canonical coordinate — coincident boundaries
 * cluster deterministically inside one scripture flow — and the key
 * doubles as the emphasis hook for the legend's URL selection.
 */
export interface UnitBoundaryMarker {
	/** Owning layer's `"{reading}:{scheme}[:{variant}]"` key — a merged
	 * coincident marker carries every constituent key space-separated,
	 * and emphasis matches any of them. */
	key: string;
	/** Ordinal label shown as the marker's main text. */
	label: string;
	role?: "aliyah" | "maftir";
	/** Short visible tag identifying the layer (e.g. scheme or custom
	 * name), so coincident markers stay distinguishable. */
	tag?: string;
	/** Styling category (e.g. `shabbat`/`weekday`/`joined`/`variant`) —
	 * distinguishes layers by border/typography, never color alone. */
	category?: string;
	/** Richer hover/focus/touch detail; also the accessible name. */
	detail?: string;
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
	emphasisMarkerKey,
	modestPerekLabels,
	recitationWords,
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
	 * hold several (one per reading context/scheme layer) and ALL render
	 * inline together in their map order (issue #3165). When provided,
	 * perek breaks demote to the modest pasuk-like label so the boundary
	 * markers own the prominent separator treatment. */
	boundaryMarkers?: ReadonlyMap<string, readonly UnitBoundaryMarker[]>;
	/** Optional layer key rendered emphasized (the legend's URL-selected
	 * `"{reading}:{scheme}[:{variant}]"`); every marker still shows. */
	emphasisMarkerKey?: string;
	/** Demotes perek-break labels to the modest pasuk-like style even
	 * where no boundary markers exist — e.g. the parasha reader's
	 * Haftarah text, which shares the page with an annotated Torah
	 * reading (issue #2519). */
	modestPerekLabels?: boolean;
	/** Wrap each spoken word in the shared recitation control (issue
	 * #3259): inside a `RangeRecitationPlayer` the words play and
	 * highlight, outside one they render plain text unchanged. */
	recitationWords?: boolean;
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
	// Each rendered copy also gets a 0-based occurrence ordinal: identical
	// copies share recording timestamps, so the recitation controls use
	// the ordinal to tap and highlight the right instance.
	const firstSliceByCoord = new Map<string, number>();
	const occurrenceByPasuk = new Map<string, number>();
	const coordCounts = new Map<string, number>();
	slices.forEach((slice, index) => {
		for (let pasuk = slice.startPasuk; pasuk <= slice.endPasuk; pasuk++) {
			const coord = `${slice.perekId}-${pasuk}`;
			if (!firstSliceByCoord.has(coord)) firstSliceByCoord.set(coord, index);
			occurrenceByPasuk.set(`${index}-${pasuk}`, coordCounts.get(coord) ?? 0);
			coordCounts.set(coord, (coordCounts.get(coord) ?? 0) + 1);
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
					occurrenceByPasuk={occurrenceByPasuk}
					anchorScope={anchorScope}
					entityRefs={entityRefsByPerek[slice.perekId] ?? []}
					resolvePerek={resolvePerek}
					showPerekLabel={multiPerek && !unitPositionMarkers}
					modestPerekLabel={modestPerekLabels || boundaryMarkers != null}
					boundaryMarkers={boundaryMarkers}
					emphasisMarkerKey={emphasisMarkerKey}
					firstPosition={
						unitPositionMarkers ? firstPositions[sliceIndex] : undefined
					}
					recitationWords={recitationWords}
				/>
			))}
		</>
	);
}

function UnitPerekSlice({
	slice,
	sliceIndex,
	firstSliceByCoord,
	occurrenceByPasuk,
	anchorScope,
	entityRefs,
	resolvePerek,
	showPerekLabel,
	modestPerekLabel,
	boundaryMarkers,
	emphasisMarkerKey,
	firstPosition,
	recitationWords,
}: {
	slice: PerekSlice;
	sliceIndex: number;
	firstSliceByCoord: Map<string, number>;
	/** `"sliceIndex-pasuk"` → that rendered copy's ordinal among this
	 * coordinate's copies (0-based, in declared reading order). */
	occurrenceByPasuk: Map<string, number>;
	anchorScope?: string;
	entityRefs: PerekEntityReference[];
	resolvePerek: UnitTextPerekResolver;
	showPerekLabel: boolean;
	modestPerekLabel?: boolean;
	boundaryMarkers?: ReadonlyMap<string, readonly UnitBoundaryMarker[]>;
	emphasisMarkerKey?: string;
	firstPosition?: number;
	recitationWords?: boolean;
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
					const boundary = mergeBoundaryMarkers(
						boundaryMarkers?.get(`${slice.perekId}:${pasukNumber}`) ?? [],
					);
					return (
						<span
							key={pasukNumber}
							id={
								emitsAnchor
									? `pasuk-${slice.perekId}-${pasukNumber}${anchorScope ? `-${anchorScope}` : ""}`
									: undefined
							}
						>
							{boundary.length > 0 && (
								<span className={styles.aliyahMarkerCluster}>
									{boundary.map((mark) => (
										/* Coincident agreeing layers render as one merged
										 * pill (issue #3165); the tag keeps divergent
										 * ordinals distinguishable and the button's
										 * focus/hover — and its touch tap — reveals the
										 * full division detail. */
										<button
											key={mark.key}
											type="button"
											className={styles.aliyahBreakLabel}
											data-aliyah-marker=""
											data-aliyah-key={mark.key}
											data-aliyah-role={mark.role}
											data-aliyah-category={mark.category}
											data-aliyah-selected={
												emphasisMarkerKey != null &&
												mark.key.split(" ").includes(emphasisMarkerKey)
													? ""
													: undefined
											}
											aria-label={
												mark.detail ??
												[mark.tag, mark.label].filter(Boolean).join(" ")
											}
										>
											{mark.tag && (
												<span
													className={styles.aliyahMarkerTag}
													aria-hidden="true"
												>
													{mark.tag}
												</span>
											)}{" "}
											<span className={styles.aliyahMarkerOrdinal}>
												{mark.label}
											</span>
											{mark.detail && (
												<span
													className={styles.aliyahMarkerDetail}
													aria-hidden="true"
												>
													{mark.detail}
												</span>
											)}
										</button>
									))}
								</span>
							)}
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
								(entryUniqueName, children, key) =>
									recitationWords ? (
										// Keep entity links out of listening mode so
										// interactive elements never nest — the same
										// RecitationLink swap the /929 reader uses. The
										// perek scopes listening mode: a perek without a
										// recording keeps its links even when sibling
										// perakim in the section play.
										<RecitationLink
											key={key}
											perek={slice.perekId}
											link={
												<TanahpediaLink
													key={key}
													entryUniqueName={entryUniqueName}
													className={perekStyles.tanahpediaLink}
												>
													{children}
												</TanahpediaLink>
											}
										>
											{children}
										</RecitationLink>
									) : (
										<TanahpediaLink
											key={key}
											entryUniqueName={entryUniqueName}
											className={perekStyles.tanahpediaLink}
										>
											{children}
										</TanahpediaLink>
									),
								recitationWords
									? (wrappedPasuk, segment, text) => (
											<RecitationWordControl
												perek={slice.perekId}
												pasuk={wrappedPasuk}
												segment={segment}
												occurrence={occurrenceByPasuk.get(
													`${sliceIndex}-${wrappedPasuk}`,
												)}
												plainWhenInactive
											>
												{text}
											</RecitationWordControl>
										)
									: undefined,
							)}{" "}
						</span>
					);
				})}
		</>
	);
}
