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

import type { PerekObj } from "@/data/perek-dto";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
import type { ArticleSummary } from "@/lib/articles";
import {
	getStoredPerekViewMode,
	pathnameWithBookQuery,
	setStoredPerekViewMode,
} from "@/lib/perek-view-preference";
import type { PerushSummary } from "@/lib/perushim";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import ReadModeToggler from "./ReadModeToggler";
import styles from "./sefer-composite.module.css";

// Lazy-load the heavy Sefer (FlipBook) component so its JS bundle is not
// included in the initial page load.  When the user toggles book-view the
// chunk is fetched asynchronously, which keeps the interaction-to-next-paint
// well below 200 ms because the browser only needs to paint the light
// overlay — not mount the entire FlipBook tree — in the same frame.
const Sefer = dynamic(() => import("./Sefer"), {
	ssr: false,
	loading: () => (
		<output className={styles.loadingContainer} aria-label="טוען תצוגת ספר...">
			<div className={styles.loadingSpinner} />
		</output>
	),
});

function SeferLoadingIndicator() {
	return (
		<output className={styles.loadingContainer} aria-label="טוען תצוגת ספר...">
			<div className={styles.loadingSpinner} />
		</output>
	);
}

const ClientWrapper = (props: {
	perekObj: PerekObj;
	articles: ArticleSummary[];
	perushim: PerushSummary[];
	perekIds?: number[];
	entityRefsByPerek?: Record<number, PerekEntityReference[]>;
	/** When set, the book view will auto-expand this article/perush on the current perek page */
	initialSlug?: string;
}) => {
	const isWideEnough = useIsWideEnough(TABLET_MIN_WIDTH);
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const appliedStoredPreference = useRef(false);

	// A better design is to control the toggling state from outside this
	// component, but in that case the entire page rendering method is changed
	// from SSG to dynamic, affecting performance and SEO / AIO. So in that
	// tradeoff, this component handles the toggling state internally.
	const toggled = searchParams.get("book") != null;
	const [everToggled, setEverToggled] = useState(false);
	const [currentlyToggled, setCurrentlyToggled] = useState(false);
	const [display, setDisplay] = useState("none");

	const handleToggle = useCallback(
		(wantBook: boolean, immediately = false) => {
			if (wantBook) {
				// Show the overlay immediately so the toggle animation is responsive.
				setDisplay("initial");
				setCurrentlyToggled(true);
				// Defer the expensive <Sefer> mount to a transition so the browser
				// can paint the toggle visual feedback first, keeping INP < 200 ms.
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
				setCurrentlyToggled(false);
			}
		},
		[everToggled],
	);

	// Apply saved book preference once (tablet+): add ?book if user chose sefer view.
	useEffect(() => {
		if (isWideEnough !== true || appliedStoredPreference.current) return;
		appliedStoredPreference.current = true;
		const stored = getStoredPerekViewMode();
		if (stored === "book" && searchParams.get("book") == null) {
			const next = pathnameWithBookQuery(pathname, searchParams.toString(), true);
			router.replace(next, { scroll: false });
		}
	}, [isWideEnough, pathname, router, searchParams]);

	// URL is source of truth: persist when user lands with ?book
	useEffect(() => {
		if (toggled) {
			setStoredPerekViewMode("book");
		}
	}, [toggled]);

	const onToggleFromUser = useCallback(
		(wantBook: boolean) => {
			setStoredPerekViewMode(wantBook ? "book" : "seo");
			const next = pathnameWithBookQuery(
				pathname,
				searchParams.toString(),
				wantBook,
			);
			router.replace(next, { scroll: false });
			handleToggle(wantBook, wantBook);
		},
		[handleToggle, pathname, router, searchParams],
	);

	useEffect(() => {
		if (everToggled) return;
		const IMMEDIATELY = true;
		handleToggle(toggled, IMMEDIATELY);
	}, [toggled, handleToggle, everToggled]);

	// When the book view is active, mark the document so a global CSS rule
	// can hide the heavy SEO content underneath the overlay.  This removes
	// the SEO DOM from the rendering pipeline, eliminating the layout
	// recalculation cost that was causing flip animation lag.
	useEffect(() => {
		if (currentlyToggled) {
			document.documentElement.dataset.bookView = "";
		} else {
			delete document.documentElement.dataset.bookView;
		}
		return () => {
			delete document.documentElement.dataset.bookView;
		};
	}, [currentlyToggled]);

	// Don't render anything on mobile - sefer view is tablet+ only
	// Return null during SSR/initial render to avoid hydration mismatch,
	// then check viewport after hydration
	if (isWideEnough === false) {
		return null;
	}

	return (
		<>
			<ReadModeToggler toggled={toggled} onToggle={onToggleFromUser} />
			<div
				style={{ display }}
				className={`${styles.seferOverlay} ${
					currentlyToggled ? styles.visible : styles.hidden
				}`}
			>
			{everToggled ? (
				<Sefer
					perekObj={props.perekObj}
					articles={props.articles}
					perushim={props.perushim}
					perekIds={props.perekIds}
					entityRefsByPerek={props.entityRefsByPerek}
					initialSlug={props.initialSlug}
				/>
			) : currentlyToggled ? (
				<SeferLoadingIndicator />
			) : null}
			</div>
		</>
	);
};

export default ClientWrapper;
