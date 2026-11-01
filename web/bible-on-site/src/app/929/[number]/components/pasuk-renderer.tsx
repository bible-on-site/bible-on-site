import React from "react";
import type { Segment } from "@/data/db/tanah-view-types";
import { isQriDifferentThanKtiv } from "@/data/db/tanah-view-types";
import { containsDivineName } from "@/lib/divine-name-masking";
import type { EntityRefLookup } from "@/lib/tanahpedia/entity-ref-lookup";
import { getSegmentRuns } from "@/lib/tanahpedia/entity-ref-lookup";
import { DivineNameText } from "./DivineNameText";

type WordWrapper = (
	pasuk: number,
	segment: number,
	text: React.ReactNode,
) => React.ReactNode;

interface SegmentRangeResult {
	content: React.ReactNode[];
	trailingSpace: boolean;
}

export function renderSegmentRange(
	segments: Segment[],
	startIdx: number,
	endIdx: number,
	pasukIdx: number,
	ptuha: () => React.ReactNode,
	stuma: () => React.ReactNode,
	qriClassName: string,
	wordWrapper?: WordWrapper,
): SegmentRangeResult {
	const content: React.ReactNode[] = [];
	for (let i = startIdx; i <= endIdx; i++) {
		const segment = segments[i];
		const segmentKey = `${pasukIdx + 1}-${i + 1}`;
		const isQriWithDifferentKtiv =
			segment.type === "qri" && isQriDifferentThanKtiv(segment);
		// הסתר שם השם is display-only: the wrapped element reads the stored
		// preference and renders the masked form, while segment identity —
		// keys, word indices, recitation alignment — stays canonical.
		// Ordinary words never change with the preference, so they need no
		// client component or external-store subscription.
		let value: React.ReactNode = null;
		if (segment.type === "ktiv" || segment.type === "qri") {
			value = containsDivineName(segment.value) ? (
				<DivineNameText value={segment.value} />
			) : (
				segment.value
			);
		}
		const segmentContent = (
			<>
				{segment.type === "ktiv" ? (
					value
				) : segment.type === "qri" ? (
					isQriWithDifferentKtiv ? (
						<>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: It'll take some time to validate this fix altogether with css rules */}
							(<label />
							{wordWrapper?.(pasukIdx + 1, i + 1, value) ?? value})
						</>
					) : (
						(wordWrapper?.(pasukIdx + 1, i + 1, value) ?? value)
					)
				) : segment.type === "ptuha" ? (
					ptuha()
				) : (
					stuma()
				)}
			</>
		);
		// The recitation control already owns each word's element. Ordinary
		// words and spaces need no extra layout objects when a chapter mounts.
		content.push(
			isQriWithDifferentKtiv ? (
				<span key={segmentKey} className={qriClassName}>
					{segmentContent}
				</span>
			) : (
				<React.Fragment key={segmentKey}>{segmentContent}</React.Fragment>
			),
		);
		const needsSpace =
			i < segments.length - 1 &&
			!(
				(segment.type === "ktiv" || segment.type === "qri") &&
				segment.value.at(segment.value.length - 1) === "־"
			);
		if (needsSpace && i < endIdx) {
			content.push(" ");
		}
	}
	const lastSeg = segments[endIdx];
	const trailingSpace =
		endIdx < segments.length - 1 &&
		!(
			(lastSeg.type === "ktiv" || lastSeg.type === "qri") &&
			lastSeg.value.at(lastSeg.value.length - 1) === "־"
		);
	return { content, trailingSpace };
}

/**
 * Intersects pasuk runs with a segment bound for partial-pasuk rendering
 * (reading-division range bounds may start or end mid-pasuk). Runs fully
 * outside the bound are dropped; boundary runs are clipped.
 */
export function clipSegmentRuns<T extends { startIdx: number; endIdx: number }>(
	runs: T[],
	startIdx: number,
	endIdx: number,
): T[] {
	return runs
		.map((run) => ({
			...run,
			startIdx: Math.max(run.startIdx, startIdx),
			endIdx: Math.min(run.endIdx, endIdx),
		}))
		.filter((run) => run.startIdx <= run.endIdx);
}

/**
 * Renders a pasuk's segments with entity ref links.
 * linkWrapper: renders a linked run (receives entryUniqueName, children, key).
 */
export function renderPasukWithEntityRefs(
	segments: Segment[],
	pasukIdx: number,
	entityRefLookup: EntityRefLookup,
	ptuha: () => React.ReactNode,
	stuma: () => React.ReactNode,
	qriClassName: string,
	linkWrapper: (
		entryUniqueName: string,
		children: React.ReactNode[],
		key: string,
	) => React.ReactNode,
	wordWrapper?: WordWrapper,
): React.ReactNode[] {
	return renderPasukSegmentsWithEntityRefs(
		segments,
		pasukIdx,
		0,
		segments.length - 1,
		entityRefLookup,
		ptuha,
		stuma,
		qriClassName,
		linkWrapper,
		wordWrapper,
	);
}

/**
 * Renders a segment sub-range of a pasuk with entity ref links — the
 * shared text resolver for reading-division units whose bounds may cut
 * inside a pasuk (מסורה intra-pasuk breaks, Haftarah partial pesukim).
 * Entity-ref runs are clipped to the bound, so a linked phrase cut by a
 * unit boundary keeps its link on the included portion.
 */
export function renderPasukSegmentsWithEntityRefs(
	segments: Segment[],
	pasukIdx: number,
	startIdx: number,
	endIdx: number,
	entityRefLookup: EntityRefLookup,
	ptuha: () => React.ReactNode,
	stuma: () => React.ReactNode,
	qriClassName: string,
	linkWrapper: (
		entryUniqueName: string,
		children: React.ReactNode[],
		key: string,
	) => React.ReactNode,
	wordWrapper?: WordWrapper,
): React.ReactNode[] {
	const runs = clipSegmentRuns(
		getSegmentRuns(entityRefLookup, pasukIdx + 1, segments.length),
		startIdx,
		endIdx,
	);
	return runs.map((run) => {
		const { content, trailingSpace } = renderSegmentRange(
			segments,
			run.startIdx,
			run.endIdx,
			pasukIdx,
			ptuha,
			stuma,
			qriClassName,
			wordWrapper,
		);
		const trailSpace = trailingSpace ? " " : null;
		const runKey = `run-${pasukIdx + 1}-${run.startIdx}`;
		if (run.ref?.entryUniqueName) {
			return (
				<React.Fragment key={runKey}>
					{linkWrapper(run.ref.entryUniqueName, content, runKey)}
					{trailSpace}
				</React.Fragment>
			);
		}
		return (
			<React.Fragment key={runKey}>
				{content}
				{trailSpace}
			</React.Fragment>
		);
	});
}
