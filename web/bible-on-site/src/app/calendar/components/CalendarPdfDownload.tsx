"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	attachmentFilename,
	triggerBrowserDownload,
} from "@/lib/download/browser-download";
import styles from "./learning-calendar.module.css";

/**
 * Calendar PDF download action (#2621): a secondary control that lives in
 * the calendar toolbar next to the period pickers. The PDF is fetched only
 * after explicit activation — never on view changes — through the shared
 * `/api/calendar-pdf` contract. While a request is in flight the button is
 * disabled so one click never starts duplicate work; the request keeps the
 * period it was started for even if the user navigates the calendar
 * meanwhile. Status reaches screen readers through a polite live region.
 */
export function CalendarPdfDownload({
	url,
	scopeLabel,
}: {
	/** The `/api/calendar-pdf?…` URL for the currently selected period. */
	url: string;
	/** Concise selected period, e.g. "אלול ה'תשפ\"ה", "שנת ה'תשפ\"ה", "מחזור 4". */
	scopeLabel: string;
}) {
	const [phase, setPhase] = useState<
		"idle" | "preparing" | "downloading" | "done" | "error"
	>("idle");
	const [statusText, setStatusText] = useState("");
	// Guards late async completions after unmount or a superseded request.
	const requestId = useRef(0);
	const mounted = useRef(true);
	useEffect(
		() => () => {
			mounted.current = false;
		},
		[],
	);

	const begin = useCallback(() => {
		const id = ++requestId.current;
		const label = scopeLabel;
		const alive = () => mounted.current && requestId.current === id;
		setPhase("preparing");
		setStatusText(`מכין PDF של ${label}…`);
		void (async () => {
			try {
				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(`calendar-pdf responded ${response.status}`);
				}
				if (!alive()) {
					return;
				}
				setPhase("downloading");
				setStatusText(`מוריד PDF של ${label}…`);
				const blob = await response.blob();
				triggerBrowserDownload(
					blob,
					attachmentFilename(
						response.headers.get("Content-Disposition"),
						"learning-calendar.pdf",
					),
				);
				if (!alive()) {
					return;
				}
				setPhase("done");
				setStatusText(`הורדת PDF של ${label} החלה`);
			} catch {
				if (!alive()) {
					return;
				}
				setPhase("error");
				setStatusText(`הורדת PDF של ${label} נכשלה — נסו שוב`);
			}
		})();
	}, [url, scopeLabel]);

	const busy = phase === "preparing" || phase === "downloading";
	return (
		<span className={styles.downloadAction}>
			<button
				type="button"
				className={styles.downloadButton}
				onClick={begin}
				disabled={busy}
				aria-busy={busy}
				aria-label={`הורדת PDF: ${scopeLabel}`}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M12 3v12" />
					<path d="m7 11 5 5 5-5" />
					<path d="M4 21h16" />
				</svg>
				<span className={styles.downloadLabel}>הורדת PDF</span>
				<span className={styles.downloadScope} aria-hidden="true">
					{scopeLabel}
				</span>
			</button>
			<span
				role="status"
				className={`${styles.downloadStatus} ${
					phase === "error" ? styles.downloadError : ""
				}`}
			>
				{statusText}
			</span>
		</span>
	);
}
