"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	startTransition,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import ReadModeToggler from "@/app/929/[number]/components/ReadModeToggler";
import seferStyles from "@/app/929/[number]/components/sefer-composite.module.css";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
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
	loading: () => (
		<output
			className={seferStyles.loadingContainer}
			aria-label="טוען תצוגת ספר..."
		>
			<div className={seferStyles.loadingSpinner} />
		</output>
	),
});

function SeferLoadingIndicator() {
	return (
		<output
			className={seferStyles.loadingContainer}
			aria-label="טוען תצוגת ספר..."
		>
			<div className={seferStyles.loadingSpinner} />
		</output>
	);
}

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
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const appliedStoredPreference = useRef(false);
	const handledUserToggle = useRef(false);

	const toggled = searchParams.get("book") != null;
	const [everToggled, setEverToggled] = useState(false);
	const [currentlyToggled, setCurrentlyToggled] = useState(false);
	const [display, setDisplay] = useState("none");

	const handleToggle = useCallback(
		(wantBook: boolean, immediately = false) => {
			if (wantBook) {
				setDisplay("initial");
				setCurrentlyToggled(true);
				if (!everToggled) {
					startTransition(() => {
						setEverToggled(true);
					});
				}
			} else {
				if (immediately) {
					setDisplay("none");
				} else {
					setTimeout(() => {
						setDisplay("none");
					}, 300);
				}
				window.dispatchEvent(new Event("recitation-stop"));
				setCurrentlyToggled(false);
			}
		},
		[everToggled],
	);

	// Apply saved book preference once (tablet+): add ?book if user chose sefer view.
	useEffect(() => {
		if (isWideEnough !== true || appliedStoredPreference.current) return;
		appliedStoredPreference.current = true;
		if (/^#pasuk-[1-9]\d*(-\d+)?$/.test(window.location.hash)) return;
		const stored = getStoredMasoraViewMode();
		if (stored === "book" && searchParams.get("book") == null) {
			const next = pathnameWithMasoraBookQuery(
				pathname,
				searchParams.toString(),
				true,
			);
			router.replace(next, { scroll: false });
		}
	}, [isWideEnough, pathname, router, searchParams]);

	useEffect(() => {
		if (toggled) {
			setStoredMasoraViewMode("book");
		}
	}, [toggled]);

	const onToggleFromUser = useCallback(
		(wantBook: boolean) => {
			handledUserToggle.current = true;
			setStoredMasoraViewMode(wantBook ? "book" : "seo");
			// While the book is open the flipbook owns the URL — on exit
			// read the live location so flipping to another unit returns
			// to that unit's flat page, and an open content selection
			// keeps its flat-page meaning via the shared params.
			const togglePath = wantBook
				? pathname
				: masoraBookExitPath(window.location.pathname, props.currentUnitId);
			const search = wantBook
				? searchParams.toString()
				: window.location.search;
			const next = pathnameWithMasoraBookQuery(togglePath, search, wantBook);
			router.replace(next, { scroll: false });
			handleToggle(wantBook, wantBook);
		},
		[handleToggle, pathname, props.currentUnitId, router, searchParams],
	);

	useEffect(() => {
		if (everToggled || handledUserToggle.current) return;
		const IMMEDIATELY = true;
		handleToggle(toggled, IMMEDIATELY);
	}, [toggled, handleToggle, everToggled]);

	useEffect(() => {
		if (currentlyToggled && isWideEnough === true) {
			document.documentElement.dataset.bookView = "";
		} else {
			delete document.documentElement.dataset.bookView;
		}
		return () => {
			delete document.documentElement.dataset.bookView;
		};
	}, [currentlyToggled, isWideEnough]);

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
