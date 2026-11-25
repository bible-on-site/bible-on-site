"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalDialogFocus } from "@/hooks/useModalDialogFocus";
import styles from "./page.module.css";

interface JournalismItem {
	id: number;
	title: string;
	description: string;
	imageUrl: string;
}

export function JournalismGallery({ items }: { items: JournalismItem[] }) {
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [opener, setOpener] = useState<HTMLElement | null>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	useModalDialogFocus(selectedIndex !== null, dialogRef, opener);

	const close = useCallback(() => setSelectedIndex(null), []);

	const goNext = useCallback(() => {
		setSelectedIndex((prev) =>
			/* istanbul ignore next -- defensive: nav buttons only exist while the modal is open */
			prev !== null ? (prev + 1) % items.length : null,
		);
	}, [items.length]);

	const goPrev = useCallback(() => {
		setSelectedIndex((prev) =>
			/* istanbul ignore next -- defensive: nav buttons only exist while the modal is open */
			prev !== null ? (prev - 1 + items.length) % items.length : null,
		);
	}, [items.length]);

	useEffect(() => {
		if (selectedIndex === null) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
			else if (e.key === "ArrowLeft")
				goNext(); // RTL: left = next
			else if (e.key === "ArrowRight") goPrev(); // RTL: right = prev
		};

		document.body.style.overflow = "hidden";
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.body.style.overflow = "";
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [selectedIndex, close, goNext, goPrev]);

	const selected = selectedIndex !== null ? items[selectedIndex] : null;

	return (
		<>
			<div className={styles.masonryGrid}>
				{items.map((item, index) => (
					<button
						key={item.id}
						type="button"
						className={styles.masonryItem}
						onClick={(e) => {
							setOpener(e.currentTarget);
							setSelectedIndex(index);
						}}
					>
						<Image
							src={item.imageUrl}
							alt={item.title}
							width={600}
							height={800}
							className={styles.itemImage}
						/>
						<div className={styles.itemOverlay}>
							<h2 className={styles.itemTitle}>{item.title}</h2>
							<p className={styles.itemDescription}>{item.description}</p>
						</div>
					</button>
				))}
			</div>

			{selected &&
				createPortal(
					<div
						ref={dialogRef}
						className={styles.modalBackdrop}
						onClick={close}
						onKeyDown={(e) => {
							// Enter/Space close only when the backdrop itself is the
							// target — keys raised on the dialog's controls belong to them.
							if (
								e.target === e.currentTarget &&
								(e.key === "Enter" || e.key === " ")
							)
								close();
						}}
						role="dialog"
						aria-modal="true"
						aria-label={selected.title}
						tabIndex={-1}
					>
						<div
							className={styles.modalContent}
							onClick={(e) => e.stopPropagation()}
							onKeyDown={() => {}}
							role="document"
						>
							<button
								type="button"
								className={styles.modalClose}
								onClick={close}
								aria-label="סגור"
								data-modal-action="close"
							>
								✕
							</button>

							{items.length > 1 && (
								<>
									<button
										type="button"
										className={`${styles.modalNav} ${styles.modalNavNext}`}
										onClick={goNext}
										aria-label="הבא"
									>
										›
									</button>
									<button
										type="button"
										className={`${styles.modalNav} ${styles.modalNavPrev}`}
										onClick={goPrev}
										aria-label="הקודם"
									>
										‹
									</button>
								</>
							)}

							{/* biome-ignore lint/performance/noImgElement: modal image URL is dynamic (selected at runtime), next/image requires known dimensions */}
							<img
								src={selected.imageUrl}
								alt={selected.title}
								className={styles.modalImage}
							/>
							<div className={styles.modalCaption}>
								<h2 className={styles.modalTitle}>{selected.title}</h2>
								<p className={styles.modalDescription}>
									{selected.description}
								</p>
							</div>
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}
