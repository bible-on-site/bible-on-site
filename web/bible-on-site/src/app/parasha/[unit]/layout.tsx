import "@/lib/download/register-tanach";
import type React from "react";
import UnitSwipeNavigation from "@/app/components/UnitSwipeNavigation";
import ReaderSettings from "@/app/929/[number]/components/ReaderSettings";
import { hebrewSerif, taameyD } from "@/app/929/[number]/hebrew-font";
import "@/app/929/[number]/layout.css";
import {
	getAdjacentParashaUnits,
	PARASHA_DIVISION,
} from "@/data/parasha/parasha-units";
import { resolveParashaSegment } from "@/data/parasha/parasha-slugs";

/**
 * פרשה unit pages share the /929 reader chrome: the same swipe
 * navigation, reader settings (font/spacing/recitation), Taamey D and
 * Noto fonts, and the reader layout stylesheet (blue nav, overflow
 * containment).
 */
export default async function ParashaUnitLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ unit: string }>;
}) {
	const { unit } = await params;
	// Params arrive percent-encoded (same convention as /929/[slug]).
	let segment = unit;
	try {
		segment = decodeURIComponent(unit);
	} catch {
		segment = unit;
	}
	const resolved = resolveParashaSegment(segment);
	const { prev, next } =
		resolved?.kind === "canonical"
			? getAdjacentParashaUnits(resolved.unitId)
			: { prev: null, next: null };

	return (
		<UnitSwipeNavigation
			prevHref={prev ? `${PARASHA_DIVISION.rootPath}/${prev.slug}` : null}
			nextHref={next ? `${PARASHA_DIVISION.rootPath}/${next.slug}` : null}
			className={`perek-layout ${hebrewSerif.variable} ${taameyD.variable}`}
		>
			<ReaderSettings />
			{children}
		</UnitSwipeNavigation>
	);
}
