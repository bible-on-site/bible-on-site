"use client";

import { useEffect, useState } from "react";
import catalog from "@/data/db/client-catalog.generated.json";
import type { Perek } from "@/data/db/tanah-view-types";
import { BookRequestError, loadSefer, seferPerekMap } from "@/data/load-sefer";
import type { ArticleSummary } from "@/lib/articles";
import type { RangePerushSummary } from "@/lib/perushim";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import MasoraSefer from "./MasoraSefer";
import type { BookPage, MasoraBookUnit } from "./masora-book-utils";
import styles from "@/app/929/[number]/components/sefer-composite.module.css";
import type { UnitBookContentKind } from "@/app/components/reading/unit-book-content";

/**
 * Loads the sefer's own JSON — Masoretic units never cross sefarim, so
 * a single file covers every unit page in the book — then renders the
 * מסורה sefer book. The payload stays client-only: the flat SSG page
 * keeps light.
 */
export default function MasoraLoadedSefer(props: {
	units: MasoraBookUnit[];
	seferName: string;
	currentUnitId: number;
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
	perekSources: Record<number, string>;
	articles: ArticleSummary[];
	perushim: RangePerushSummary[];
	/** Feature-level מסורה על הפרק dedication lines (#2731). */
	coverDedications?: string[];
	initialBookPage: BookPage | null;
	initialContent?: {
		scope: "torah";
		kind: UnitBookContentKind;
		slug: string;
	} | null;
	isVisible?: boolean;
}) {
	const file = catalog.books.find(
		(book) => book.name === props.seferName,
	)?.file;

	const [loaded, setLoaded] = useState<Map<number, Perek> | null>(null);
	const [failure, setFailure] = useState<{ refreshPage: boolean } | null>(
		null,
	);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let current = true;
		if (attempt > 0) {
			setLoaded(null);
		}
		setFailure(null);
		if (!file) {
			setFailure({ refreshPage: false });
			return;
		}
		loadSefer(file)
			.then((sefer) => {
				if (!current) return;
				setLoaded(seferPerekMap(sefer));
			})
			.catch((error) => {
				if (current) {
					console.error("Failed to load masora book", { file, error });
					setFailure({
						refreshPage:
							error instanceof BookRequestError &&
							error.status === 404,
					});
				}
			});
		return () => {
			current = false;
		};
	}, [file, attempt]);

	if (failure) {
		return (
			<div className={styles.loadingContainer} role="alert">
				<p>לא ניתן לטעון את הספר.</p>
				{failure.refreshPage ? (
					<a href={window.location.pathname + window.location.search}>
						רענן את הדף
					</a>
				) : (
					<button type="button" onClick={() => setAttempt((v) => v + 1)}>
						נסה שוב
					</button>
				)}
			</div>
		);
	}
	if (loaded == null) {
		return (
			<output
				className={styles.loadingContainer}
				aria-label="טוען תצוגת ספר..."
			>
				<div className={styles.loadingSpinner} />
			</output>
		);
	}
	return (
		<MasoraSefer
			units={props.units}
			seferName={props.seferName}
			currentUnitId={props.currentUnitId}
			entityRefsByPerek={props.entityRefsByPerek}
			perekSources={props.perekSources}
			perekById={loaded}
			articles={props.articles}
			perushim={props.perushim}
			coverDedications={props.coverDedications}
			initialBookPage={props.initialBookPage}
			initialContent={props.initialContent}
			isVisible={props.isVisible}
		/>
	);
}
