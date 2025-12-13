"use client";
import { useCallback, useEffect, useState } from "react";

import type { PerekObj } from "@/data/perek-dto";
import ReadModeToggler from "./ReadModeToggler";
import Sefer from "./Sefer";
import styles from "./sefer-composite.module.css";

const ClientWrapper = (props: { perekObj: PerekObj; toggled: boolean }) => {
	const { toggled } = props;
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
