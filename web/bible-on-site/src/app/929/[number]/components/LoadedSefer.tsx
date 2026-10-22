"use client";

import { type ComponentProps, useEffect, useState } from "react";
import catalog from "@/data/db/client-catalog.generated.json";
import type { SefarimItem } from "@/data/db/tanah-view-types";
import { BookRequestError, loadSefer } from "@/data/load-sefer";
import Sefer from "./Sefer";
import styles from "./sefer-composite.module.css";

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

	useEffect(() => {
		if (!file) return;
		let current = true;
		if (attempt > 0) setResult(null);
		setFailure(null);
		loadSefer(file)
			.then((sefer) => {
				if (current) setResult({ file, sefer });
			})
			.catch((error) => {
				if (current) {
					console.error("Failed to load reader book", { file, error });
					setFailure({
						file,
						refreshPage: error instanceof BookRequestError && error.status === 404,
					});
				}
			});
		return () => {
			current = false;
		};
	}, [file, attempt]);

	if (!file || failure?.file === file) {
		return (
			<div className={styles.loadingContainer} role="alert">
				<p>לא ניתן לטעון את הספר.</p>
				{failure?.refreshPage ? (
					<a href={window.location.pathname + window.location.search}>רענן את הדף</a>
				) : (
					<button type="button" onClick={() => setAttempt((value) => value + 1)}>
						נסה שוב
					</button>
				)}
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
