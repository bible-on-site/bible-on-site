"use client";

import { useEffect, useMemo, useState } from "react";
import { getPerakimText } from "@/app/components/reading/unit-book-actions";
import catalog from "@/data/db/client-catalog.generated.json";
import type { Pasuk, Perek } from "@/data/db/tanah-view-types";
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
 * Loads the Torah sefer plus just the perakim its parashot's Haftarot
 * reach (a single range-scoped request rather than whole prophetic
 * sefarim), then renders the פרשה sefer book. The auxiliary payload
 * stays fetched only when the book view opens — the flat SSG page
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
	/** Parasha-scoped dedication lines per unit (#2731). */
	dedicationsByUnit?: Record<number, string[]>;
	initialBookPage: BookPage | null;
	haftara: boolean;
	initialContent?: {
		scope: UnitBookScope;
		kind: UnitBookContentKind;
		slug: string;
	} | null;
	isVisible?: boolean;
}) {
	const mainFile = useMemo(
		() =>
			catalog.books.find((book) => book.name === props.seferName)?.file,
		[props.seferName],
	);
	/** Canonical perek ids the parashot's Haftarot render — fetched
	 * range-scoped, not as whole-sefer downloads. */
	const auxPerekIds = useMemo(() => {
		const ids = new Set<number>();
		for (const unit of props.units) {
			for (const haftara of unit.haftarot) {
				for (const range of haftara.ranges) {
					for (
						let perekId = range.start.perekId;
						perekId <= range.end.perekId;
						perekId++
					) {
						ids.add(perekId);
					}
				}
			}
		}
		return [...ids].sort((a, b) => a - b);
	}, [props.units]);

	const [loaded, setLoaded] = useState<Map<
		number,
		Pick<Perek, "pesukim">
	> | null>(null);
	const [loadedKey, setLoadedKey] = useState("");
	const [failure, setFailure] = useState<{ refreshPage: boolean } | null>(null);
	const [attempt, setAttempt] = useState(0);
	const loadKey = `${mainFile ?? ""}|${auxPerekIds.join(",")}`;

	// Both inputs are memoized on the same props; loadKey keeps the
	// effect honest across prop changes without re-running on identity.
	useEffect(() => {
		let current = true;
		if (attempt > 0) {
			setLoaded(null);
		}
		setFailure(null);
		Promise.all([
			mainFile ? loadSefer(mainFile) : Promise.resolve(null),
			getPerakimText(auxPerekIds),
		])
			.then(([sefer, auxPerakim]) => {
				if (!current) return;
				const map = new Map<number, { pesukim: Pasuk[] }>();
				for (const [perekId, perek] of Object.entries(auxPerakim)) {
					map.set(Number(perekId), perek);
				}
				if (sefer) {
					for (const [perekId, perek] of seferPerekMap(sefer)) {
						map.set(perekId, perek);
					}
				}
				setLoaded(map);
				setLoadedKey(loadKey);
			})
			.catch((error) => {
				if (current) {
					console.error("Failed to load parasha book", {
						sefer: props.seferName,
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
	}, [loadKey, attempt, mainFile, auxPerekIds, props.seferName]);

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
	if (loaded == null || loadedKey !== loadKey) {
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
			dedicationsByUnit={props.dedicationsByUnit}
			initialBookPage={props.initialBookPage}
			haftara={props.haftara}
			initialContent={props.initialContent}
			isVisible={props.isVisible}
		/>
	);
}
