"use client";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { startTransition, useCallback, useEffect, useState } from "react";

import type { PerekObj } from "@/data/perek-dto";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
import type { Article } from "@/lib/articles";
import type { PerushSummary } from "@/lib/perushim";
import ReadModeToggler from "./ReadModeToggler";
import styles from "./sefer-composite.module.css";

// Lazy-load the heavy Sefer (FlipBook) component so its JS bundle is not
// included in the initial page load.  When the user toggles book-view the
// chunk is fetched asynchronously, which keeps the interaction-to-next-paint
// well below 200 ms because the browser only needs to paint the light
// overlay — not mount the entire FlipBook tree — in the same frame.
const Sefer = dynamic(() => import("./Sefer"), { ssr: false });

const ClientWrapper = (props: {
	perekObj: PerekObj;
	articles: Article[];
	articlesByPerekIndex?: Article[][];
	perushimByPerekIndex?: PerushSummary[][];
	perekIds?: number[];
}) => {
	const isWideEnough = useIsWideEnough(TABLET_MIN_WIDTH);

	// A better design is to control the toggling state from outside this
	// component, but in that case the entire page rendering method is changed
	// from SSG to dynamic, affecting performance and SEO / AIO. So in that
	// tradeoff, this component handles the toggling state internally.
	const searchParams = useSearchParams();
	const toggled = searchParams.get("book") != null;
	const [everToggled, setEverToggled] = useState(false);
	const [currentlyToggled, setCurrentlyToggled] = useState(false);
	const [display, setDisplay] = useState("none");
	const handleToggle = useCallback(
		(toggled: boolean, immediately = false) => {
			if (toggled) {
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

	useEffect(() => {
		if (everToggled) return;
		const IMMEDIATELY = true;
		handleToggle(toggled, IMMEDIATELY);
	}, [toggled, handleToggle, everToggled]);

	// Don't render anything on mobile - sefer view is tablet+ only
	// Return null during SSR/initial render to avoid hydration mismatch,
	// then check viewport after hydration
	if (isWideEnough === false) {
		return null;
	}

	return (
		<>
			<ReadModeToggler toggled={toggled} onToggle={handleToggle} />
			<div
				style={{ display }}
				className={`${styles.seferOverlay} ${
					currentlyToggled ? styles.visible : styles.hidden
				}`}
			>
				{everToggled && (
					<Sefer
						perekObj={props.perekObj}
						articles={props.articles}
						articlesByPerekIndex={props.articlesByPerekIndex}
						perushimByPerekIndex={props.perushimByPerekIndex}
						perekIds={props.perekIds}
					/>
				)}
			</div>
		</>
	);
};

export default ClientWrapper;
