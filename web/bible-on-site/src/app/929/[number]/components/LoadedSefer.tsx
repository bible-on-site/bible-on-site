"use client";

import { type ComponentProps, useEffect, useState } from "react";
import catalog from "@/data/db/client-catalog.generated.json";
import type { SefarimItem } from "@/data/db/tanah-view-types";
import { BookRequestError, loadSefer } from "@/data/load-sefer";
import {
	pathnameWithBookQuery,
	setStoredPerekViewMode,
} from "@/lib/perek-view-preference";
import Sefer from "./Sefer";
import styles from "./sefer-composite.module.css";
import { bookPageFromPath } from "./sefer-page-utils";

/**
 * A missing asset answers a real 404: bundle and deployment no longer
 * agree, so retrying the same hashed URL cannot help — only a fresh page
 * load picks up a consistent pair. Every other failure (an ingress 5xx
 * during a deploy handover, a dropped connection, a truncated body) is
 * retried automatically a bounded number of times while the spinner stays
 * up, so short deploy-window faults never surface as an error (#3095).
 */
const AUTO_RETRY_DELAYS_MS = [1500, 3000] as const;

export default function LoadedSefer(
	props: Omit<ComponentProps<typeof Sefer>, "sefer">,
) {
	const file = catalog.books.find(
		(book) =>
			props.perekObj.perekId >= book.perekFrom &&
			props.perekObj.perekId <= book.perekTo,
	)?.file;
	const [result, setResult] = useState<{
		file: string;
		sefer: SefarimItem;
	} | null>(null);
	const [failure, setFailure] = useState<{
		file: string;
		refreshPage: boolean;
	} | null>(null);
	const [attempt, setAttempt] = useState(0);

	// An absent catalog mapping has nothing to re-fetch; report it once per
	// unmapped perek so the dead state stays diagnosable. Kept out of the
	// load effect: its dep set must not pull perekId into a re-fetch.
	useEffect(() => {
		if (file) return;
		console.error("Reader book missing from catalog", {
			perekId: props.perekObj.perekId,
		});
	}, [file, props.perekObj.perekId]);

	useEffect(() => {
		if (!file) return;
		let current = true;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		if (attempt > 0) setResult(null);
		setFailure(null);
		loadSefer(file)
			.then((sefer) => {
				if (current) setResult({ file, sefer });
			})
			.catch((error) => {
				if (!current) return;
				console.error("Failed to load reader book", { file, error });
				const refreshPage =
					error instanceof BookRequestError && error.status === 404;
				if (!refreshPage && attempt < AUTO_RETRY_DELAYS_MS.length) {
					// Cleanup clears the timer, so the callback only runs mounted.
					retryTimer = setTimeout(() => {
						setAttempt((value) => value + 1);
					}, AUTO_RETRY_DELAYS_MS[attempt]);
					return;
				}
				setFailure({ file, refreshPage });
			});
		return () => {
			current = false;
			if (retryTimer !== undefined) clearTimeout(retryTimer);
		};
	}, [file, attempt]);

	if (!file || failure?.file === file) {
		// Book-chrome URLs (/929/{sefer}/{slug}) rewrite to the reader
		// regardless of their query, so stripping ?book cannot leave the
		// book there — the escape lands on the plain perek page instead.
		// Every other route keeps its flat chapter/article target (#3095).
		// Landing on ?book= also stored the book preference, which the flat
		// page would restore — re-entering the failed reader. The escape
		// clears it to "seo" first, the same write the view toggle makes.
		const flatViewHref = bookPageFromPath(
			window.location.pathname,
			props.perekObj.sefer,
		)
			? `/929/${props.perekObj.perekId}`
			: pathnameWithBookQuery(
					window.location.pathname,
					window.location.search,
					false,
				);
		return (
			<div className={styles.loadingContainer} role="alert">
				<div className={styles.loadingError}>
					<p>לא ניתן לטעון את הספר.</p>
					<div className={styles.loadingActions}>
						{!file || failure?.refreshPage ? null : (
							<button
								type="button"
								onClick={() => setAttempt((value) => value + 1)}
							>
								נסה שוב
							</button>
						)}
						<a href={window.location.pathname + window.location.search}>
							רענן את הדף
						</a>
						<a
							href={flatViewHref}
							onClick={() => setStoredPerekViewMode("seo")}
						>
							חזרה לתצוגת הפרק
						</a>
					</div>
				</div>
			</div>
		);
	}
	if (result?.file !== file) {
		return (
			<output
				className={styles.loadingContainer}
				aria-label="טוען תצוגת ספר..."
			>
				<div className={styles.loadingSpinner} />
			</output>
		);
	}
	return <Sefer {...props} sefer={result.sefer} />;
}
