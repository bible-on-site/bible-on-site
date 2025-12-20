"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { PerekObj } from "@/data/perek-dto";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
import ReadModeToggler from "./ReadModeToggler";
import Sefer from "./Sefer";
import styles from "./sefer-composite.module.css";

const ClientWrapper = (props: { perekObj: PerekObj }) => {
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
			console.log(
				`handleToggle(toggled: ${toggled}, immediately: ${immediately})`,
			);
			if (!everToggled && toggled) {
				setEverToggled(true);
			}
			if (toggled) {
				setDisplay("initial");
				setCurrentlyToggled(true);
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
		console.log(everToggled);
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
				{/* TODO: figure out how to not affecting INP when toggling (some sort of async rendering?)) */}
				{everToggled && <Sefer perekObj={props.perekObj} />}
			</div>
		</>
	);
};

export default ClientWrapper;
