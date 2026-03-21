import React from "react";
import type { Segment } from "@/data/db/tanah-view-types";
import { isQriDifferentThanKtiv } from "@/data/db/tanah-view-types";
import type { EntityRefLookup } from "@/lib/tanahpedia/entity-ref-lookup";
import { getSegmentRuns } from "@/lib/tanahpedia/entity-ref-lookup";

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
): SegmentRangeResult {
	const content: React.ReactNode[] = [];
	for (let i = startIdx; i <= endIdx; i++) {
		const segment = segments[i];
		const segmentKey = `${pasukIdx + 1}-${i + 1}`;
		const isQriWithDifferentKtiv =
			segment.type === "qri" && isQriDifferentThanKtiv(segment);
		content.push(
			<span
				key={segmentKey}
				className={isQriWithDifferentKtiv ? qriClassName : ""}
			>
				{segment.type === "ktiv" ? (
					segment.value
				) : segment.type === "qri" ? (
					isQriWithDifferentKtiv ? (
						<>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: It'll take some time to validate this fix altogether with css rules */}
							(<label />
							{segment.value})
						</>
					) : (
						segment.value
					)
				) : segment.type === "ptuha" ? (
					ptuha()
				) : (
					stuma()
				)}
			</span>,
		);
		const needsSpace =
			i < segments.length - 1 &&
			!((segment.type === "ktiv" || segment.type === "qri") &&
				segment.value.at(segment.value.length - 1) === "־");
		if (needsSpace && i < endIdx) {
			content.push(<span key={`sp-${segmentKey}`}> </span>);
		}
	}
	const lastSeg = segments[endIdx];
	const trailingSpace =
		endIdx < segments.length - 1 &&
		!((lastSeg.type === "ktiv" || lastSeg.type === "qri") &&
			lastSeg.value.at(lastSeg.value.length - 1) === "־");
	return { content, trailingSpace };
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
): React.ReactNode[] {
	const runs = getSegmentRuns(
		entityRefLookup,
		pasukIdx + 1,
		segments.length,
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
		);
		const trailSpan = trailingSpace ? (
			<span key={`sp-trail-${pasukIdx + 1}-${run.endIdx + 1}`}> </span>
		) : null;
		const runKey = `run-${pasukIdx + 1}-${run.startIdx}`;
		if (run.ref?.entryUniqueName) {
			return (
				<React.Fragment key={runKey}>
					{linkWrapper(run.ref.entryUniqueName, content, runKey)}
					{trailSpan}
				</React.Fragment>
			);
		}
		return (
			<React.Fragment key={runKey}>
				{content}
				{trailSpan}
			</React.Fragment>
		);
	});
}
