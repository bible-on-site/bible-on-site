"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBookshelfDedicationLines } from "@/app/929/[number]/actions";
import type { BookshelfDedicationLines } from "@/lib/dedications/loaders";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
import { Bookshelf } from "./Bookshelf";
import styles from "./bookshelf-modal.module.css";

interface BookshelfModalProps {
	/** Whether the modal is open */
	isOpen: boolean;
	/** Callback to close the modal */
	onClose: () => void;
}

/**
 * Modal overlay displaying the bookshelf.
 * Closes on backdrop click or Escape key.
 */
const BookshelfModal: React.FC<BookshelfModalProps> = ({ isOpen, onClose }) => {
	const router = useRouter();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const isWideEnough = useIsWideEnough(TABLET_MIN_WIDTH);
	// Shelf dedications (#2731) load when the picker actually opens — the
	// readers never pay the query for a modal they may not open.
	const [dedications, setDedications] =
		useState<BookshelfDedicationLines | null>(null);
	useEffect(() => {
		if (!isOpen || dedications !== null) return;
		let cancelled = false;
		getBookshelfDedicationLines()
			.then((result) => {
				if (!cancelled) setDedications(result);
			})
			.catch((error) => {
				console.error("Failed to load bookshelf dedications", error);
			});
		return () => {
			cancelled = true;
		};
	}, [isOpen, dedications]);

	// Handle escape key
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isOpen) {
				onClose();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	// When isOpen becomes true, show the native dialog. When isOpen is false
	// the component returns null (below), unmounting the dialog before this
	// effect can run, so dialogRef.current is null and the early return fires.
	useEffect(() => {
		if (!isOpen) return;
		dialogRef.current?.showModal();
	}, [isOpen]);

	// Handle backdrop click
	const handleBackdropClick = useCallback(
		(e: React.MouseEvent<HTMLDialogElement>) => {
			// Close if clicking on the backdrop (dialog itself, not its children)
			if (e.target === dialogRef.current) {
				onClose();
			}
		},
		[onClose],
	);

	// Navigate to sefer and close modal.
	// On wide screens, open sefer (book) view; otherwise just the perek route.
	// The Bookshelf component passes today's perekId for the bookmarked sefer,
	// or perekFrom for all other sefarim.
	const handleSeferClick = useCallback(
		(_seferName: string, targetPerek: number) => {
			onClose();
			const path = `/929/${targetPerek}`;
			const query = isWideEnough ? "?book" : "";
			router.push(`${path}${query}`);
		},
		[router, onClose, isWideEnough],
	);

	const handleBackdropKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLDialogElement>) => {
			if (e.key === "Escape") {
				onClose();
			}
		},
		[onClose],
	);

	if (!isOpen) return null;

	return (
		<dialog
			ref={dialogRef}
			className={styles.modal}
			onClick={handleBackdropClick}
			onKeyDown={handleBackdropKeyDown}
			aria-label={'ספרי התנ"ך'}
		>
			<div className={styles.content}>
				<button
					type="button"
					className={styles.closeButton}
					onClick={onClose}
					aria-label="סגור"
				>
					×
				</button>
				<Bookshelf
					onSeferClick={handleSeferClick}
					dedications={dedications ?? undefined}
				/>
			</div>
		</dialog>
	);
};

export { BookshelfModal };
export type { BookshelfModalProps };
