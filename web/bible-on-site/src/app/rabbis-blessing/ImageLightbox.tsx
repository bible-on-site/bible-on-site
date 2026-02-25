"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./page.module.css";

interface ImageLightboxProps {
	src: string;
	alt: string;
	width: number;
	height: number;
}

export function ImageLightbox({ src, alt, width, height }: ImageLightboxProps) {
	const [open, setOpen] = useState(false);

	const close = useCallback(() => setOpen(false), []);

	useEffect(() => {
		if (!open) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};

		document.body.style.overflow = "hidden";
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.body.style.overflow = "";
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [open, close]);

	return (
		<>
			<button
				type="button"
				className={styles.posterButton}
				onClick={() => setOpen(true)}
			>
				<Image
					src={src}
					alt={alt}
					width={width}
					height={height}
					className={styles.posterImage}
				/>
			</button>

			{open &&
				createPortal(
					<div
						className={styles.modalBackdrop}
						onClick={close}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") close();
						}}
						role="dialog"
						aria-modal="true"
						aria-label={alt}
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
							{/* biome-ignore lint/performance/noImgElement: lightbox image src is dynamic, next/image requires known dimensions */}
							<img src={src} alt={alt} className={styles.modalImage} />
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}
