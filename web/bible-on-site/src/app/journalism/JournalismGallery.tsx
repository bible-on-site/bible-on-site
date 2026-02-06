"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./page.module.css";

interface JournalismItem {
	id: number;
	title: string;
	description: string;
	imageUrl: string;
}

export function JournalismGallery({ items }: { items: JournalismItem[] }) {
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

	const close = useCallback(() => setSelectedIndex(null), []);

	const goNext = useCallback(() => {
		setSelectedIndex((prev) =>
			prev !== null ? (prev + 1) % items.length : null,
		);
	}, [items.length]);

	const goPrev = useCallback(() => {
		setSelectedIndex((prev) =>
			prev !== null ? (prev - 1 + items.length) % items.length : null,
		);
	}, [items.length]);

	useEffect(() => {
		if (selectedIndex === null) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
			else if (e.key === "ArrowLeft") goNext(); // RTL: left = next
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
						onClick={() => setSelectedIndex(index)}
					>
						<Image
							src={item.imageUrl}
							alt={item.title}
							width={600}
							height={800}
							className={styles.itemImage}
							unoptimized
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
						className={styles.modalBackdrop}
						onClick={close}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") close();
						}}
						role="dialog"
						aria-modal="true"
						aria-label={selected.title}
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

							{/* biome-ignore lint/a11y/useAltText: alt provided via parent aria-label */}
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
