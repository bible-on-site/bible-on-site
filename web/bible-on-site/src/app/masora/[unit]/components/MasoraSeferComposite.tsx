"use client";

import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import ReadModeToggler from "@/app/929/[number]/components/ReadModeToggler";
import seferStyles from "@/app/929/[number]/components/sefer-composite.module.css";
import { SeferLoadingIndicator } from "@/app/components/reading/SeferLoadingIndicator";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
import { useSeferBookToggle } from "@/hooks/useSeferBookToggle";
import type { ArticleSummary } from "@/lib/articles";
import {
	getStoredMasoraViewMode,
	setStoredMasoraViewMode,
} from "@/lib/perek-view-preference";
import type { RangePerushSummary } from "@/lib/perushim";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import {
	type MasoraBookUnit,
	masoraBookExitPath,
	masoraBookPageFromPath,
	masoraBookPageFromQuery,
	pathnameWithMasoraBookQuery,
} from "./masora-book-utils";

// Lazy-load the heavy Sefer (FlipBook) component so its JS bundle is not
// included in the initial page load — same pattern as the /929 reader.
const MasoraLoadedSefer = dynamic(() => import("./MasoraLoadedSefer"), {
	ssr: false,
	loading: () => <SeferLoadingIndicator />,
});

/**
 * Flat-view ↔ sefer-book toggler for the מסורה reader. The book shows
 * the unit's sefer sliced by Masoretic parashot — each unit's text page
 * followed by its bounded commentary page — never conventional
 * perakim.
 */
export const MasoraSeferComposite = (props: {
	units: MasoraBookUnit[];
	seferName: string;
	currentUnitId: number;
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
	perekSources: Record<number, string>;
	articles: ArticleSummary[];
	perushim: RangePerushSummary[];
	/** Feature-level מסורה על הפרק dedication lines (#2731). */
	coverDedications?: string[];
}) => {
	const isWideEnough = useIsWideEnough(TABLET_MIN_WIDTH);
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { toggled, everToggled, currentlyToggled, display, onToggleFromUser } =
		useSeferBookToggle(isWideEnough, props.currentUnitId, {
			getStored: getStoredMasoraViewMode,
			setStored: setStoredMasoraViewMode,
			withBookQuery: pathnameWithMasoraBookQuery,
			exitPath: masoraBookExitPath,
		});

	if (isWideEnough === false) {
		return null;
	}
	const initialBookPage =
		masoraBookPageFromPath(pathname) ??
		masoraBookPageFromQuery(searchParams.get("bookPage")) ??
		(searchParams.get("toc") != null ? "toc" : null);
	const perush = searchParams.get("perush");
	const article = searchParams.get("article");
	const initialContent =
		perush != null
			? { scope: "torah" as const, kind: "perush" as const, slug: perush }
			: article != null
				? {
						scope: "torah" as const,
						kind: "article" as const,
						slug: article,
					}
				: null;

	return (
		<>
			<ReadModeToggler toggled={toggled} onToggle={onToggleFromUser} />
			<div
				style={{ display }}
				className={`${seferStyles.seferOverlay} ${
					currentlyToggled ? seferStyles.visible : seferStyles.hidden
				}`}
			>
				{everToggled ? (
					<MasoraLoadedSefer
						key={props.seferName}
						units={props.units}
						seferName={props.seferName}
						currentUnitId={props.currentUnitId}
						entityRefsByPerek={props.entityRefsByPerek}
						perekSources={props.perekSources}
						articles={props.articles}
						perushim={props.perushim}
						coverDedications={props.coverDedications}
						initialBookPage={initialBookPage}
						initialContent={initialContent}
						isVisible={currentlyToggled}
					/>
				) : currentlyToggled ? (
					<SeferLoadingIndicator />
				) : null}
			</div>
		</>
	);
};
