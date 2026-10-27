"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	attachmentFilename,
	openRemoteDownload,
	triggerBrowserDownload,
} from "@/lib/download/browser-download";
import { resolveCalendarPdfAsset } from "@/lib/download/calendar-pdf-client";
import styles from "./learning-calendar.module.css";

/**
 * One PDF the user asked to download (#2622): the canonical artifact key and
 * the static manifest that resolves it, plus the legacy API URL kept as the
 * authoritative fallback for artifacts the manifest does not (yet) publish.
 */
export interface CalendarPdfRequest {
	/** Canonical artifact key — `cycle:N`, `year:YYYY` or `month:YYYYMM`. */
	artifactKey: string;
	/** Static manifest object URL in the shared assets bucket. */
	manifestUrl: string;
	/** Filename the published artifact carries; also the download hint. */
	filename: string;
	/** Legacy `/api/calendar-pdf?…` URL — resolves fresh server-side. */
	apiUrl: string;
}

/**
 * Calendar PDF download action (#2621, asset-direct since #2622): a secondary
 * control that lives in the calendar toolbar next to the period pickers.
 *
 * Clicking resolves the artifact key against the published manifest — fetched
 * lazily on first activation, never while browsing — and hands the published
 * object URL straight to the browser's download UI (the object carries
 * `Content-Disposition: attachment`, so the filename and progress are the
 * browser's own). When the manifest is unreachable or the artifact is not
 * published yet, the legacy `/api/calendar-pdf` URL is fetched instead: it
 * re-checks a fresh manifest server-side and either redirects to the object
 * or answers 404/503, which maps onto an honest unavailable/preparing status.
 *
 * While a request is in flight the button is disabled so one click never
 * starts duplicate work; the request keeps the period it was started for even
 * if the user navigates the calendar meanwhile. Status reaches screen readers
 * through a polite live region.
 */
export function CalendarPdfDownload({
	request,
	scopeLabel,
}: {
	request: CalendarPdfRequest;
	/** Concise selected period, e.g. "אלול ה'תשפ\"ה", "שנת ה'תשפ\"ה", "מחזור ד'". */
	scopeLabel: string;
}) {
	const [phase, setPhase] = useState<
		"idle" | "preparing" | "downloading" | "done" | "error"
	>("idle");
	const [statusText, setStatusText] = useState("");
	// Guards late async completions after unmount or a superseded request.
	const requestId = useRef(0);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const begin = useCallback(() => {
		const id = ++requestId.current;
		const label = scopeLabel;
		const req = request;
		const alive = () => mounted.current && requestId.current === id;
		setPhase("preparing");
		setStatusText(`מכין PDF של ${label}…`);
		void (async () => {
			const asset = await resolveCalendarPdfAsset(
				req.manifestUrl,
				req.artifactKey,
			);
			if (!alive()) {
				return;
			}
			if (asset) {
				// The object already answers attachment+filename; the browser's
				// download UI owns progress from here.
				openRemoteDownload(asset.url, asset.filename);
				setPhase("done");
				setStatusText(`הורדת PDF של ${label} החלה`);
				return;
			}

			// Compatibility path: the legacy route re-checks a fresh manifest
			// server-side, so a just-published artifact still resolves here.
			try {
				const response = await fetch(req.apiUrl);
				if (!alive()) {
					return;
				}
				if (!response.ok) {
					setPhase("error");
					setStatusText(
						response.status === 503
							? `PDF של ${label} עדיין בהכנה — נסו שוב בעוד מעט`
							: response.status === 404
								? `PDF של ${label} אינו זמין`
								: `הורדת PDF של ${label} נכשלה — נסו שוב`,
					);
					return;
				}
				setPhase("downloading");
				setStatusText(`מוריד PDF של ${label}…`);
				const blob = await response.blob();
				triggerBrowserDownload(
					blob,
					attachmentFilename(
						response.headers.get("Content-Disposition"),
						req.filename,
					),
				);
				if (!alive()) {
					return;
				}
				setPhase("done");
				setStatusText(`הורדת PDF של ${label} החלה`);
			} catch (error) {
				console.error(`calendar PDF download failed for ${label}`, error);
				if (!alive()) {
					return;
				}
				setPhase("error");
				setStatusText(`הורדת PDF של ${label} נכשלה — נסו שוב`);
			}
		})();
	}, [request, scopeLabel]);

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
