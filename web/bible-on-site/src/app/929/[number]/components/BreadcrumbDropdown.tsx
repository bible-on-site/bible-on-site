"use client";

import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import styles from "./breadcrumb.module.css";

/** Breadcrumb item whose selector opens on click, Enter or Space (hover stays for mice). */
export function BreadcrumbDropdown({
	label,
	ariaLabel,
	isCurrentPage,
	dropClassName = "",
	dropStyle,
	children,
}: {
	label: ReactNode;
	ariaLabel: string;
	isCurrentPage?: boolean;
	dropClassName?: string;
	dropStyle?: CSSProperties;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const itemRef = useRef<HTMLLIElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		const closeOutside = (e: Event) => {
			if (!itemRef.current?.contains(e.target as Node)) setOpen(false);
		};
		const closeOnSelect = (e: MouseEvent) => {
			const target = e.target as Element;
			if (itemRef.current?.contains(target) && target.closest("a"))
				setOpen(false);
		};
		const closeOnEscape = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			setOpen(false);
			buttonRef.current?.focus();
		};
		document.addEventListener("pointerdown", closeOutside);
		document.addEventListener("focusin", closeOutside);
		document.addEventListener("click", closeOnSelect);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOutside);
			document.removeEventListener("focusin", closeOutside);
			document.removeEventListener("click", closeOnSelect);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [open]);

	return (
		<li
			ref={itemRef}
			className={`${styles.active} ${styles.relative} ${styles["drop-container"]}`}
			aria-current={isCurrentPage ? "page" : undefined}
		>
			<button
				ref={buttonRef}
				type="button"
				aria-haspopup="true"
				aria-expanded={open}
				aria-label={ariaLabel}
				onClick={() => setOpen((wasOpen) => !wasOpen)}
			>
				{label}
				<span
					className={`${styles.glyphicon} ${styles["glyphicon-triangle-bottom"]} ${styles.small}`}
					aria-hidden="true"
				/>
			</button>
			<div
				className={`${styles.drop} ${styles["bg-white"]} ${dropClassName}`}
				style={dropStyle}
			>
				{children}
			</div>
		</li>
	);
}
