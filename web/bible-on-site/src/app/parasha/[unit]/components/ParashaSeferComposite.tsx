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
	getStoredParashaViewMode,
	setStoredParashaViewMode,
} from "@/lib/perek-view-preference";
import type { RangePerushSummary } from "@/lib/perushim";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import {
	type ParashaBookUnit,
	parashaBookExitPath,
	parashaBookPageFromPath,
	parashaBookPageFromQuery,
	pathnameWithParashaBookQuery,
} from "./parasha-book-utils";

// Lazy-load the heavy Sefer (FlipBook) component so its JS bundle is not
// included in the initial page load — same pattern as the /929 reader.
const ParashaLoadedSefer = dynamic(() => import("./ParashaLoadedSefer"), {
	ssr: false,
	loading: () => <SeferLoadingIndicator />,
});

/**
 * Flat-view ↔ sefer-book toggler for the פרשה reader. The book shows the
 * parasha's sefer sliced by parashiot — each parasha contributes a
 * Torah spread (text + commentary blank) followed by a Haftarah spread
 * — never a division toggle inside /929.
 */
export const ParashaSeferComposite = (props: {
	units: ParashaBookUnit[];
	seferName: string;
	currentUnitId: number;
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
	perekSources: Record<number, string>;
	/** Current unit's flat-page summaries, reused as its SSG carousel data. */
	articles: ArticleSummary[];
	perushim: RangePerushSummary[];
	haftaraArticles: ArticleSummary[];
	haftaraPerushim: RangePerushSummary[];
	/** Parasha-scoped dedication lines per unit — once per Torah spread (#2731). */
	dedicationsByUnit?: Record<number, string[]>;
}) => {
	const isWideEnough = useIsWideEnough(TABLET_MIN_WIDTH);
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { toggled, everToggled, currentlyToggled, display, onToggleFromUser } =
		useSeferBookToggle(isWideEnough, props.currentUnitId, {
			getStored: getStoredParashaViewMode,
			setStored: setStoredParashaViewMode,
			withBookQuery: pathnameWithParashaBookQuery,
			exitPath: parashaBookExitPath,
		});

	if (isWideEnough === false) {
		return null;
	}
	const initialBookPage =
		parashaBookPageFromPath(pathname) ??
		parashaBookPageFromQuery(searchParams.get("bookPage")) ??
		(searchParams.get("toc") != null ? "toc" : null);
	// A content selection on the flat page keeps its meaning inside the
	// book: `perush`/`article` open on the Torah blank, the haftara
	// variants on the Haftarah blank (the same params the flat unit
	// pages use).
	const perush = searchParams.get("perush");
	const article = searchParams.get("article");
	const haftaraPerush = searchParams.get("haftaraPerush");
	const haftaraArticle = searchParams.get("haftaraArticle");
	const initialContent = haftaraPerush
		? {
				scope: "haftara" as const,
				kind: "perush" as const,
				slug: haftaraPerush,
			}
		: haftaraArticle
			? {
					scope: "haftara" as const,
					kind: "article" as const,
					slug: haftaraArticle,
				}
			: perush
				? { scope: "torah" as const, kind: "perush" as const, slug: perush }
				: article
					? {
							scope: "torah" as const,
							kind: "article" as const,
							slug: article,
						}
					: null;

	return (
		<>
			<ReadModeToggler toggled={toggled} onToggle={onToggleFromUser} />
			<main
				style={{ display }}
				className={`${seferStyles.seferOverlay} ${
					currentlyToggled ? seferStyles.visible : seferStyles.hidden
				}`}
			>
				{everToggled ? (
					<ParashaLoadedSefer
						key={props.seferName}
						units={props.units}
						seferName={props.seferName}
						currentUnitId={props.currentUnitId}
						entityRefsByPerek={props.entityRefsByPerek}
						perekSources={props.perekSources}
						articles={props.articles}
						perushim={props.perushim}
						haftaraArticles={props.haftaraArticles}
						haftaraPerushim={props.haftaraPerushim}
						dedicationsByUnit={props.dedicationsByUnit}
						initialBookPage={initialBookPage}
						haftara={searchParams.get("haftara") != null}
						initialContent={initialContent}
						isVisible={currentlyToggled}
					/>
				) : currentlyToggled ? (
					<SeferLoadingIndicator />
				) : null}
			</main>
		</>
	);
};
