"use client";

import styles from "./sefer.module.css";
import {
	clearSeferPasukSelection,
	setSeferPasukSelectionMode,
	useSeferPasukSelection,
	useSeferPasukSelectionMode,
} from "./sefer-pasuk-selection";

/**
 * Floating control shown on a scripture page while its pasuk-selection mode
 * is on (#2544 item 3): reports how many pesukim are picked, clears them,
 * and exits the mode. Selection itself happens on the pasuk letters.
 */
export function SeferPasukSelectionBar({ perekId }: { perekId: number }) {
	const mode = useSeferPasukSelectionMode(perekId);
	const selected = useSeferPasukSelection(perekId);
	if (!perekId || !mode) return null;
	return (
		<div
			className={styles.pasukSelectionBar}
			data-flipbook-no-flip
			role="status"
		>
			<span className={styles.pasukSelectionStatus}>
				{selected.size > 0
					? `נבחרו ${selected.size} פסוקים`
					: "סמנו פסוקים על הפרק"}
			</span>
			{selected.size > 0 && (
				<button
					type="button"
					className={styles.pasukSelectionButton}
					onClick={() => clearSeferPasukSelection(perekId)}
				>
					ניקוי בחירה
				</button>
			)}
			<button
				type="button"
				className={styles.pasukSelectionButton}
				onClick={() => setSeferPasukSelectionMode(perekId, false)}
			>
				סיום בחירה
			</button>
		</div>
	);
}
