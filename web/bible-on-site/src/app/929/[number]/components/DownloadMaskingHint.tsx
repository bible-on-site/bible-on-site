"use client";

import { openReaderSettings } from "@/lib/recitation-settings";
import styles from "./sefer.module.css";

/**
 * The הסתר שם השם hint — passed to DownloadDropdown's children slot, which
 * renders it at the end of the open download menu (html-flip-book alpha.73+).
 */
export function DownloadMaskingHint() {
	return (
		<p className={styles.downloadHint}>
			מומלץ לבחון{" "}
			<button
				type="button"
				className={styles.downloadHintLink}
				onClick={(event) => openReaderSettings("display", event.currentTarget)}
			>
				הסתרת שם השם
			</button>
		</p>
	);
}
