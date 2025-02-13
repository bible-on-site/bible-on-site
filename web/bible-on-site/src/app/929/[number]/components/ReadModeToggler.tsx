"use client";
import Image from "next/image";
import type React from "react";
import { forwardRef, useEffect, useRef, useState } from "react";
import styles from "./read-mode-toggler.module.css";

const ReadModeToggler = forwardRef<
	HTMLLabelElement,
	{ toggled: boolean; onToggle?: (toggled: boolean) => void }
>(function ReadModeToggler(props, ref) {
	const [toggled, setToggled] = useState(props.toggled);
	const toggleRef = useRef<HTMLLabelElement>(null);

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const isChecked = event.target.checked;
		setToggled(isChecked);
		if (props.onToggle) {
			props.onToggle(isChecked);
		}
	};

	useEffect(() => {
		setToggled(props.toggled);
	}, [props.toggled]);

	return (
		<label ref={ref ?? toggleRef} className={styles.label}>
			<input
				className={styles.input}
				id="toggle"
				type="checkbox"
				checked={toggled}
				onChange={handleChange}
			/>
			<div className={styles.toggleDiv} />
			<Image
				data-testid="read-mode-toggler-basic-view-button"
				className={styles.bookIcon}
				src="/icons/open-book.svg"
				alt="תצוגה בסיסית"
				width={16}
				height={16}
			/>
			<Image
				data-testid="read-mode-toggler-sefer-view-button"
				className={styles.noteIcon}
				src="/icons/note.svg"
				alt="תצוגת ספר"
				width={16}
				height={16}
			/>
		</label>
	);
});

export default ReadModeToggler;
