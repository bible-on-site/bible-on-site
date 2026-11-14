import "@/lib/download/register-tanach";
import type React from "react";
import ReaderSettings from "@/app/929/[number]/components/ReaderSettings";
import { hebrewSerif, taameyD } from "@/app/929/[number]/hebrew-font";
import { PageShell } from "@/app/components/PageShell";
import UnitSwipeNavigation from "@/app/components/UnitSwipeNavigation";
import "@/app/929/[number]/layout.css";
import {
	getAdjacentMasoraUnits,
	getMasoraUnitCount,
	MASORA_DIVISION,
} from "@/data/masora/masora-units";

/**
 * מסורה unit pages share the /929 reader chrome: the same swipe
 * navigation, reader settings (font/spacing/recitation), Taamey D and
 * Noto fonts, and the reader layout stylesheet (blue nav, overflow
 * containment).
 */
export default async function MasoraUnitLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ unit: string }>;
}) {
	const { unit } = await params;
	const unitId = Number.parseInt(unit, 10);
	const count = getMasoraUnitCount();
	const inRange = unitId >= 1 && unitId <= count;
	const { prev, next } = inRange
		? getAdjacentMasoraUnits(unitId)
		: { prev: null, next: null };

	return (
		<PageShell
			header="solid"
			className={`perek-layout ${hebrewSerif.variable} ${taameyD.variable}`}
		>
			<UnitSwipeNavigation
				prevHref={prev ? `${MASORA_DIVISION.rootPath}/${prev.unitId}` : null}
				nextHref={next ? `${MASORA_DIVISION.rootPath}/${next.unitId}` : null}
			>
				<ReaderSettings />
				{children}
			</UnitSwipeNavigation>
		</PageShell>
	);
}
