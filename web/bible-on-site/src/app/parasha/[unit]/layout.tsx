import "@/lib/download/register-tanach";
import type React from "react";
import ReaderSettings from "@/app/929/[number]/components/ReaderSettings";
import { hebrewSerif, taameyD } from "@/app/929/[number]/hebrew-font";
import { PageShell } from "@/app/components/PageShell";
import UnitSwipeNavigation from "@/app/components/UnitSwipeNavigation";
import "@/app/929/[number]/layout.css";
import { resolveParashaSegment } from "@/data/parasha/parasha-slugs";
import {
	getAdjacentParashaUnits,
	PARASHA_DIVISION,
} from "@/data/parasha/parasha-units";

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
		<PageShell
			header="solid"
			className={`perek-layout ${hebrewSerif.variable} ${taameyD.variable}`}
		>
			<UnitSwipeNavigation
				prevHref={prev ? `${PARASHA_DIVISION.rootPath}/${prev.slug}` : null}
				nextHref={next ? `${PARASHA_DIVISION.rootPath}/${next.slug}` : null}
			>
				<ReaderSettings />
				{children}
			</UnitSwipeNavigation>
		</PageShell>
	);
}
