'use client';
import Image from 'next/image';
import type React from 'react';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import styles from './read-mode-toggler.module.css';

const ReadModeToggler = function ReadModeToggler({
	ref,
	...props
}: { toggled: boolean; onToggle?: (toggled: boolean) => void } & {
	ref: React.RefObject<unknown>;
}) {
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
		<label ref={toggleRef} className={styles.label}>
			<input
				className={styles.input}
				id="toggle"
				type="checkbox"
				checked={toggled}
				onChange={handleChange}
			/>
			<div className={styles.toggleDiv} />
			<Image
				className={styles.bookIcon}
				src="/icons/open-book.svg"
				alt="תצוגה בסיסית"
				width={16}
				height={16}
			/>
			<Image
				className={styles.noteIcon}
				src="/icons/note.svg"
				alt="תצוגת ספר"
				width={16}
				height={16}
			/>
		</label>
	);
};

export default ReadModeToggler;
