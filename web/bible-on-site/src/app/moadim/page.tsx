import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import {
	bandRotation,
	buildMoedWheel,
	MOADIM_ROOT,
	moedHref,
	polar,
	sectorPath,
	spokeRotation,
	starOfDavidPath,
	wrapMoedName,
} from "@/lib/moadim";
import { getCachedMoadim } from "@/lib/moadim/catalogue-cache";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/opengraph";
import styles from "./page.module.css";

export async function generateMetadata(): Promise<Metadata> {
	return pageMetadata({
		title: `מועדים על הפרק | ${SITE_NAME}`,
		description:
			'קריאות התנ"ך למועדי ישראל ולימים המיוחדים — מעגל השנה של מועדים עם פסוקים, פירושים ומאמרים לכל מועד.',
		canonical: MOADIM_ROOT,
	});
}

/** Wheel geometry in the 1000×1000 viewBox — concentric bands. */
const CX = 500;
const CY = 500;
const RIM_OUT = 496;
const BAND_IN = 434;
const CELL_OUT = 428;
const CELL_IN = 170;
const HUB_R = 162;
const NAME_RADIUS = (CELL_IN + CELL_OUT) / 2;
const BAND_RADIUS = (BAND_IN + RIM_OUT) / 2;
const NAME_LINE_HEIGHT = 30;
const DATE_LINE_HEIGHT = 22;

/** Custom properties the wheel styles read — hue, saturation, slice index. */
type WheelVars = CSSProperties & {
	"--moed-h"?: number;
	"--moed-s"?: string;
	"--moed-i"?: number;
};

/** Month hue → CSS vars; month-less slices get a neutral slate. */
function hueStyle(hue: number | null): WheelVars {
	return hue == null
		? { "--moed-h": 218, "--moed-s": "14%" }
		: { "--moed-h": hue };
}

/**
 * מועדים על הפרק landing — מעגל השנה, a full annual chart: every published
 * moed owns an equal-arc sector in annual order (top first, clockwise),
 * contiguous same-month sectors merge into a coloured rim band carrying
 * the month name, and each moed name radiates along its spoke. The SVG
 * sectors are real anchors (keyboard order = annual order); decorative
 * chrome is aria-hidden. The ordered index below repeats every link with
 * its month chip so the catalogue stays discoverable at any viewport.
 */
export default async function MoadimLanding() {
	const moadim = await getCachedMoadim();
	const wheel = buildMoedWheel(moadim);

	return (
		<div className={styles.container}>
			<div className={styles.heroRow}>
				<div className={styles.heroText}>
					<h1 className={styles.heading}>מועדים על הפרק</h1>
					<p className={styles.intro}>
						מעגל השנה של קריאות התנ&quot;ך למועדי ישראל ולימים המיוחדים — כל
						מועד עם הפסוקים, הפירושים והמאמרים שלו.
					</p>
					{moadim.length === 0 && (
						<p className={styles.empty}>אין מועדים מפורסמים עדיין.</p>
					)}
				</div>
				{moadim.length > 0 && (
					<nav aria-label="גלגל המועדים" className={styles.wheelNav}>
						<svg className={styles.wheel} viewBox="0 0 1000 1000">
							<title>גלגל המועדים</title>
							{/* Outer rim — pure chrome. */}
							<circle cx={CX} cy={CY} r={RIM_OUT} className={styles.rim} />
							{/* Sector boundary ticks on the rim. */}
							<g>
								{wheel.slices.map((slice) => {
									const [x1, y1] = polar(CX, CY, RIM_OUT, slice.startDeg);
									const [x2, y2] = polar(CX, CY, RIM_OUT + 9, slice.startDeg);
									return (
										<line
											key={`tick-${slice.moed.id}`}
											x1={x1}
											y1={y1}
											x2={x2}
											y2={y2}
											className={styles.tick}
										/>
									);
								})}
							</g>
							{/* Month bands — one coloured arc per contiguous run. */}
							<g>
								{wheel.bands.map((band) => {
									const [bx, by] = polar(CX, CY, BAND_RADIUS, band.midDeg);
									return (
										<g
											key={`band-${band.key}-${band.startDeg}`}
											style={hueStyle(band.hue)}
										>
											<path
												d={sectorPath(
													CX,
													CY,
													BAND_IN,
													RIM_OUT,
													band.startDeg,
													band.endDeg,
												)}
												className={
													band.hue == null
														? styles.monthBandNeutral
														: styles.monthBand
												}
											/>
											<text
												className={styles.monthLabel}
												x={bx}
												y={by}
												textAnchor="middle"
												dominantBaseline="central"
												transform={`rotate(${bandRotation(band.midDeg)} ${bx} ${by})`}
											>
												{band.label}
											</text>
										</g>
									);
								})}
							</g>
							{/* Moed sectors — each its own clickable wedge. */}
							{wheel.slices.map((slice, index) => {
								const [tx, ty] = polar(CX, CY, NAME_RADIUS, slice.midDeg);
								const nameLines = wrapMoedName(slice.moed.name);
								const hasDate = slice.moed.dateLabel != null;
								const blockH =
									nameLines.length * NAME_LINE_HEIGHT +
									(hasDate ? DATE_LINE_HEIGHT : 0);
								const lineY = (index: number) =>
									ty -
									blockH / 2 +
									index * NAME_LINE_HEIGHT +
									NAME_LINE_HEIGHT / 2;
								const sliceStyle: WheelVars = {
									...hueStyle(slice.hue),
									"--moed-i": index,
								};
								return (
									<Link
										key={slice.moed.id}
										href={moedHref(slice.moed.slug)}
										className={styles.moedSlice}
										style={sliceStyle}
										aria-label={
											slice.moed.dateLabel != null
												? `${slice.moed.name} ${slice.moed.dateLabel}`
												: slice.moed.name
										}
									>
										<path
											d={sectorPath(
												CX,
												CY,
												CELL_IN,
												CELL_OUT,
												slice.startDeg,
												slice.endDeg,
											)}
											className={
												slice.hue == null
													? styles.moedCellNeutral
													: styles.moedCell
											}
										/>
										<text
											className={styles.moedName}
											transform={`rotate(${spokeRotation(slice.midDeg)} ${tx} ${ty})`}
											textAnchor="middle"
											dominantBaseline="central"
										>
											{nameLines.map((line, i) => (
												<tspan
													key={`${slice.moed.id}-${line}`}
													x={tx}
													y={lineY(i)}
												>
													{line}
												</tspan>
											))}
											{hasDate && (
												<tspan
													x={tx}
													y={ty + blockH / 2 - DATE_LINE_HEIGHT / 2}
													className={styles.moedDate}
												>
													{slice.moed.dateLabel}
												</tspan>
											)}
										</text>
									</Link>
								);
							})}
							{/* Center hub — מעגל השנה emblem. */}
							<g>
								<circle cx={CX} cy={CY} r={HUB_R} className={styles.hub} />
								<path
									d={starOfDavidPath(CX, CY - 22, 54)}
									className={styles.hubStar}
								/>
								<text
									x={CX}
									y={CY + 86}
									className={styles.hubTitle}
									textAnchor="middle"
								>
									מעגל השנה
								</text>
							</g>
						</svg>
					</nav>
				)}
			</div>
			{moadim.length > 0 && (
				<nav aria-label="רשימת המועדים" className={styles.index}>
					<ol className={styles.indexList}>
						{wheel.slices.map((slice) => (
							<li key={slice.moed.id} className={styles.indexItem}>
								<Link
									href={moedHref(slice.moed.slug)}
									className={styles.indexLink}
									style={hueStyle(slice.hue)}
								>
									<span className={styles.indexName}>{slice.moed.name}</span>
									{slice.moed.dateLabel && (
										<span className={styles.indexDate}>
											{slice.moed.dateLabel}
										</span>
									)}
									{slice.moed.hebrewMonth && (
										<span className={styles.indexMonth}>
											{slice.moed.hebrewMonth}
										</span>
									)}
								</Link>
							</li>
						))}
					</ol>
				</nav>
			)}
		</div>
	);
}
