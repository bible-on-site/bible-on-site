"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { sefarim } from "@/data/db/sefarim";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
import { getTodaysPerekId } from "@/data/perek-dto";
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

	// Today's perek and its sefer — computed once per mount
	const { todaysPerekId, todaysSeferName } = useMemo(() => {
		const perekId = getTodaysPerekId();
		const sefer = sefarim.find(
			(s) => s.perekFrom <= perekId && s.perekTo >= perekId,
		);
		return { todaysPerekId: perekId, todaysSeferName: sefer?.name ?? "" };
	}, []);

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

	// Handle open/close state
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		if (isOpen) {
			dialog.showModal();
		} else {
			dialog.close();
		}
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
	// If the clicked sefer is today's sefer, jump to today's perek; otherwise go to the first perek.
	const handleSeferClick = useCallback(
		(seferName: string, perekFrom: number) => {
			onClose();
			const targetPerek =
				seferName === todaysSeferName ? todaysPerekId : perekFrom;
			const path = `/929/${targetPerek}`;
			const query = isWideEnough ? "?book" : "";
			router.push(`${path}${query}`);
		},
		[router, onClose, todaysSeferName, todaysPerekId, isWideEnough],
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
			aria-label="ספרי התנ״ך"
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
				<Bookshelf onSeferClick={handleSeferClick} />
			</div>
		</dialog>
	);
};

export { BookshelfModal };
export type { BookshelfModalProps };
