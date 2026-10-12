"use client";

import { useEffect, useMemo, useState } from "react";
import catalog from "@/data/db/client-catalog.generated.json";
import type { Perek } from "@/data/db/tanah-view-types";
import { BookRequestError, loadSefer, seferPerekMap } from "@/data/load-sefer";
import type { ArticleSummary } from "@/lib/articles";
import type { RangePerushSummary } from "@/lib/perushim";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import type {
	UnitBookContentKind,
	UnitBookScope,
} from "@/app/components/reading/unit-book-content";
import ParashaSefer from "./ParashaSefer";
import type { BookPage, ParashaBookUnit } from "./parasha-book-utils";
import styles from "@/app/929/[number]/components/sefer-composite.module.css";

/**
 * Loads the Torah sefer plus every sefer its parashot's Haftarot reach,
 * then renders the פרשה sefer book. The prophetic sefarim stay auxiliary
 * payloads fetched only when the book view opens — the flat SSG page
 * stays light.
 */
export default function ParashaLoadedSefer(props: {
	units: ParashaBookUnit[];
	seferName: string;
	currentUnitId: number;
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
	perekSources: Record<number, string>;
	articles: ArticleSummary[];
	perushim: RangePerushSummary[];
	haftaraArticles: ArticleSummary[];
	haftaraPerushim: RangePerushSummary[];
	initialBookPage: BookPage | null;
	haftara: boolean;
	initialContent?: {
		scope: UnitBookScope;
		kind: UnitBookContentKind;
		slug: string;
	} | null;
	isVisible?: boolean;
}) {
	const neededFiles = useMemo(() => {
		const files = new Set<string>();
		const mainFile = catalog.books.find(
			(book) => book.name === props.seferName,
		)?.file;
		if (mainFile) files.add(mainFile);
		const auxPerekIds = new Set<number>();
		for (const unit of props.units) {
			for (const haftara of unit.haftarot) {
				for (const range of haftara.ranges) {
					for (
						let perekId = range.start.perekId;
						perekId <= range.end.perekId;
						perekId++
					) {
						auxPerekIds.add(perekId);
					}
				}
			}
		}
		for (const book of catalog.books) {
			for (const perekId of auxPerekIds) {
				if (perekId >= book.perekFrom && perekId <= book.perekTo) {
					files.add(book.file);
					break;
				}
			}
		}
		return [...files].sort();
	}, [props.seferName, props.units]);

	const [loaded, setLoaded] = useState<Map<number, Perek> | null>(null);
	const [loadedKey, setLoadedKey] = useState("");
	const [failure, setFailure] = useState<{ refreshPage: boolean } | null>(null);
	const [attempt, setAttempt] = useState(0);
	const filesKey = neededFiles.join("|");

	// neededFiles is memoized on (seferName, units); filesKey keeps the
	// effect honest across prop changes without re-running on array identity.
	useEffect(() => {
		let current = true;
		if (attempt > 0) {
			setLoaded(null);
		}
		setFailure(null);
		Promise.all(neededFiles.map((file) => loadSefer(file)))
			.then((sefarim) => {
				if (!current) return;
				const map = new Map<number, Perek>();
				for (const sefer of sefarim) {
					for (const [perekId, perek] of seferPerekMap(sefer)) {
						map.set(perekId, perek);
					}
				}
				setLoaded(map);
				setLoadedKey(filesKey);
			})
			.catch((error) => {
				if (current) {
					console.error("Failed to load parasha book", {
						files: neededFiles,
						error,
					});
					setFailure({
						refreshPage:
							error instanceof BookRequestError && error.status === 404,
					});
				}
			});
		return () => {
			current = false;
		};
	}, [filesKey, attempt, neededFiles]);

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
	if (loaded == null || loadedKey !== filesKey) {
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
		<ParashaSefer
			units={props.units}
			seferName={props.seferName}
			currentUnitId={props.currentUnitId}
			entityRefsByPerek={props.entityRefsByPerek}
			perekSources={props.perekSources}
			perekById={loaded}
			articles={props.articles}
			perushim={props.perushim}
			haftaraArticles={props.haftaraArticles}
			haftaraPerushim={props.haftaraPerushim}
			initialBookPage={props.initialBookPage}
			haftara={props.haftara}
			initialContent={props.initialContent}
			isVisible={props.isVisible}
		/>
	);
}
