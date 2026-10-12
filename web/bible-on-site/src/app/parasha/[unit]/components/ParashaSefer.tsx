"use client";

import { toLetters } from "gematry";
import type { PageSemantics } from "html-flip-book-react";
import React, { useEffect, useMemo, useState } from "react";
import type { Perek } from "@/data/db/tanah-view-types";
import type { ArticleSummary } from "@/lib/articles";
import type { RangePerushSummary } from "@/lib/perushim";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import { constructTsetAwareHDate } from "@/util/hebdates-util";
import { UnitSeferBook } from "@/app/components/reading/UnitSeferBook";
import { UnitBlankPageContent } from "@/app/components/reading/UnitBlankPageContent";
import { UnitTextBody } from "@/app/components/reading/UnitTextBody";
import {
	getUnitScopeSummariesBatch,
	type UnitBookSummaries,
} from "@/app/components/reading/unit-book-actions";
import type {
	UnitBookContentKind,
	UnitBookScope,
} from "@/app/components/reading/unit-book-content";
import { unitBookContentSlug } from "@/app/components/reading/unit-book-content";
import {
	handleUnitTextPasukClick,
	unitBookKey,
} from "@/app/components/reading/unit-book-navigation";
import { useUnitBookContentNavigation } from "@/app/components/reading/useUnitBookContentNavigation";
import {
	releaseSeferDocumentTitle,
	setSeferDocumentTitle,
} from "@/app/929/[number]/components/sefer-document-title";
import seferStyles from "@/app/929/[number]/components/sefer.module.css";
import unitPageStyles from "../page.module.css";
import {
	type BookPage,
	buildParashaDocumentTitleResolver,
	buildParashaHistoryMapper,
	buildParashaPageSemantics,
	computeParashaInitialTurnedLeaves,
	PARASHA_CONTENT_OFFSET,
	PARASHA_ROOT,
	PARASHA_ROOT_ALIASES,
	parashaBookPageRoute,
	type ParashaBookUnit,
	parashaPerushDocumentTitle,
	parashaUnitDocumentTitle,
} from "./parasha-book-utils";

/**
 * The פרשה sefer book: a flipbook over one Torah sefer sliced by
 * parashiot. Each parasha contributes a Torah spread (text page +
 * commentary blank) then a Haftarah spread (all custom variants in
 * order + commentary blank), so the whole weekly reading — and its
 * bounded commentary — sits inside the book chrome. TOC, URL history,
 * and pasuk navigation cover both spreads, never perakim.
 */
const ParashaSefer = (props: {
	units: ParashaBookUnit[];
	seferName: string;
	currentUnitId: number;
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
	perekSources: Record<number, string>;
	perekById: Map<number, Perek>;
	/** Current unit's SSG carousel data, per scope (other units load lazily). */
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
}) => {
	const {
		units,
		seferName,
		currentUnitId,
		entityRefsByPerek,
		perekSources,
		perekById,
		articles,
		perushim,
		haftaraArticles,
		haftaraPerushim,
		initialBookPage,
		haftara,
		initialContent,
		isVisible = true,
	} = props;

	const contentNavigation = useUnitBookContentNavigation(
		PARASHA_ROOT,
		PARASHA_ROOT_ALIASES,
		currentUnitId,
		initialContent,
	);

	const pasukCount = (perekId: number) =>
		perekById.get(perekId)?.pesukim.length ?? 1;
	const resolvePerek = (perekId: number) => {
		const perek = perekById.get(perekId);
		if (!perek) return undefined;
		return { pesukim: perek.pesukim, source: perekSources[perekId] ?? "" };
	};

	const pageSemantics: PageSemantics = useMemo(
		() => buildParashaPageSemantics(units),
		[units],
	);
	const historyMapper = useMemo(
		() => buildParashaHistoryMapper(units, seferName),
		[units, seferName],
	);
	const initialTurnedLeaves = useMemo(
		() =>
			initialBookPage === "front"
				? []
				: initialBookPage === "toc"
					? [0]
					: initialBookPage === "back"
						? Array.from({ length: units.length * 2 + 2 }, (_, i) => i)
						: computeParashaInitialTurnedLeaves(units, currentUnitId, haftara),
		[initialBookPage, units, currentUnitId, haftara],
	);

	// One-time batch fetch of article/perushim summaries for every
	// unit/scope except the current one (which has SSG data) — Torah
	// blanks clip to the parasha's ranges, Haftarah blanks to its
	// auxiliary readings.
	const [batchSummaries, setBatchSummaries] = useState<{
		torah: Record<string, UnitBookSummaries>;
		haftara: Record<string, UnitBookSummaries>;
	}>({ torah: {}, haftara: {} });
	useEffect(() => {
		const idsToFetch = units
			.map((unit) => unit.unitId)
			.filter((id) => id !== currentUnitId);
		if (idsToFetch.length === 0) return;
		Promise.all([
			getUnitScopeSummariesBatch("parasha", idsToFetch, "torah"),
			getUnitScopeSummariesBatch("parasha", idsToFetch, "haftara"),
		])
			.then(([torah, haftaraSummaries]) =>
				setBatchSummaries({ torah, haftara: haftaraSummaries }),
			)
			.catch((error) => {
				console.error("Failed to load parasha book summaries", {
					sefer: seferName,
					unitIds: idsToFetch,
					error,
				});
			});
	}, [units, currentUnitId, seferName]);

	// Document-title sync (issue #2176 pattern): the library's
	// onPageFlipped marks when the active page is committed — the
	// division resolver supplies what the tab says, agreeing with the
	// history mapping for the same page.
	const backCoverPageIndex = PARASHA_CONTENT_OFFSET + units.length * 4;
	const documentTitleResolver = useMemo(
		() =>
			buildParashaDocumentTitleResolver(
				seferName,
				units,
				backCoverPageIndex,
			),
		[seferName, units, backCoverPageIndex],
	);
	const [bookPageTitle, setBookPageTitle] = useState<string | null>(null);
	const [inBookContentTitle, setInBookContentTitle] = useState<
		string | null
	>(null);
	const flatPageTitle = parashaUnitDocumentTitle(
		units.find((unit) => unit.unitId === currentUnitId)?.name ?? "",
	);
	useEffect(() => {
		if (!isVisible) {
			releaseSeferDocumentTitle(flatPageTitle);
			return;
		}
		const title = inBookContentTitle ?? bookPageTitle;
		if (title != null) setSeferDocumentTitle(title);
	}, [inBookContentTitle, bookPageTitle, isVisible, flatPageTitle]);
	useEffect(
		() => () => releaseSeferDocumentTitle(flatPageTitle),
		[flatPageTitle],
	);

	const handlePageFlipped = (pageIndex: number) => {
		contentNavigation.onPageFlipped();
		setBookPageTitle(documentTitleResolver(pageIndex));
	};

	const hebrewDateStr = useMemo(
		() => constructTsetAwareHDate(new Date()).toTraditionalHebrewString(),
		[],
	);

	// Router navigation to another book URL keeps this instance; the
	// frame restores the requested spread without a history write.
	const requestedPage = historyMapper.routeToPage(
		initialBookPage
			? parashaBookPageRoute(seferName, initialBookPage)
			: `${PARASHA_ROOT}/${currentUnitId}?book${haftara ? "&haftara" : ""}`,
	);

	const scopeSummaries = (
		unit: ParashaBookUnit,
		scope: UnitBookScope,
	): UnitBookSummaries | undefined => {
		if (unit.unitId === currentUnitId) {
			return scope === "haftara"
				? { articles: haftaraArticles, perushim: haftaraPerushim }
				: { articles, perushim };
		}
		return batchSummaries[scope][String(unit.unitId)];
	};

	const contentPages = units.flatMap((unit) => {
		const unitPath = `${PARASHA_ROOT}/${unit.unitId}`;
		const torahKey = unitBookKey(unit.unitId, "torah");
		const haftaraKey = unitBookKey(unit.unitId, "haftara");
		const torahSummaries = scopeSummaries(unit, "torah");
		const haftaraSummaries = scopeSummaries(unit, "haftara");
		return [
			<React.Fragment key={`parasha-${unit.unitId}`}>
				<section
					className={seferStyles.pageContentPage}
					data-sefer-unit-text={torahKey}
				>
					<div className={seferStyles.pageHeaderRight}>
						<div className={seferStyles.pageHeaderRow}>
							<span className={seferStyles.pageHeaderSefer}>
								{seferName}
							</span>
							<span className={seferStyles.pageHeaderPerek}>
								{toLetters(unit.order)}
							</span>
						</div>
					</div>
					<div className={seferStyles.pageHeaderLeft}>
						<span>{`פרשת ${unit.name}`}</span>
						<span>{unit.refSpan}</span>
					</div>
					{/* Pasuk-numeral clicks navigate the facing open perush;
						the delegated handler no-ops everywhere else. */}
					{/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: delegated pasuk-number navigation — the real targets carry data-pasuk-num and are pointer-only text numerals */}
					<div
						className={seferStyles.perekTextScrollWrapper}
						onClick={(event) =>
							handleUnitTextPasukClick(torahKey, event.target)
						}
					>
						<article className={seferStyles.perekText}>
							<UnitTextBody
								ranges={unit.ranges}
								entityRefsByPerek={entityRefsByPerek}
								pasukCount={pasukCount}
								resolvePerek={resolvePerek}
							/>
						</article>
					</div>
				</section>
			</React.Fragment>,
			<React.Fragment key={`blank-torah-${unit.unitId}`}>
				<UnitBlankPageContent
					division="parasha"
					unitId={unit.unitId}
					scope="torah"
					unitPath={unitPath}
					articles={torahSummaries?.articles ?? []}
					perushim={torahSummaries?.perushim ?? []}
					perekSources={perekSources}
					hebrewDateStr={hebrewDateStr}
					initialSlug={unitBookContentSlug(
						contentNavigation.content,
						unit.unitId,
						"torah",
					)}
					onNavigate={(kind, slug) =>
						contentNavigation.navigate(
							unit.unitId,
							"torah",
							kind,
							slug,
						)
					}
					fallbackPerekId={unit.ranges[0]?.start.perekId ?? 0}
					titles={{
						perushim: "פרשנים על הפרשה",
						articles: "מאמרים על הפרשה",
						perushEmpty: "אין פרשנות לפרשה זו",
						articleEmpty: "אין מאמרים לפרשה זו",
					}}
					scrollStorageKey={`parasha-${unit.unitId}-torah`}
					perushTitle={(name) =>
						parashaPerushDocumentTitle(name, unit.name, false)
					}
					onContentTitle={setInBookContentTitle}
				/>
			</React.Fragment>,
			<React.Fragment key={`haftara-${unit.unitId}`}>
				<section
					className={seferStyles.pageContentPage}
					data-sefer-unit-text={haftaraKey}
				>
					<div className={seferStyles.pageHeaderRight}>
						<div className={seferStyles.pageHeaderRow}>
							<span className={seferStyles.pageHeaderSefer}>
								{seferName}
							</span>
							<span className={seferStyles.pageHeaderPerek}>
								{toLetters(unit.order)}
							</span>
						</div>
					</div>
					<div className={seferStyles.pageHeaderLeft}>
						<span>{`הפטרת ${unit.name}`}</span>
					</div>
					{/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: delegated pasuk-number navigation — the real targets carry data-pasuk-num and are pointer-only text numerals */}
					<div
						className={seferStyles.perekTextScrollWrapper}
						onClick={(event) =>
							handleUnitTextPasukClick(haftaraKey, event.target)
						}
					>
						{unit.haftarot.map((haftaraReading) => (
							<div
								key={haftaraReading.id}
								className={unitPageStyles.haftaraVariant}
							>
								<h3 className={unitPageStyles.haftaraVariantHeading}>
									{`הפטרה - ${haftaraReading.label}`}
								</h3>
								<p className={unitPageStyles.haftaraRef}>
									{haftaraReading.refSpan}
								</p>
								<article className={seferStyles.perekText}>
									<UnitTextBody
										ranges={haftaraReading.ranges}
										entityRefsByPerek={entityRefsByPerek}
										pasukCount={pasukCount}
										resolvePerek={resolvePerek}
										anchorScope={haftaraReading.id}
									/>
								</article>
								{haftaraReading.note && (
									<p className={unitPageStyles.haftaraNote}>
										{haftaraReading.note}
									</p>
								)}
							</div>
						))}
						{unit.notes.length > 0 && (
							<ul className={unitPageStyles.parashaNotes}>
								{unit.notes.map((note) => (
									<li key={note}>{note}</li>
								))}
							</ul>
						)}
					</div>
				</section>
			</React.Fragment>,
			<React.Fragment key={`blank-haftara-${unit.unitId}`}>
				<UnitBlankPageContent
					division="parasha"
					unitId={unit.unitId}
					scope="haftara"
					unitPath={unitPath}
					articles={haftaraSummaries?.articles ?? []}
					perushim={haftaraSummaries?.perushim ?? []}
					perekSources={perekSources}
					hebrewDateStr={hebrewDateStr}
					initialSlug={unitBookContentSlug(
						contentNavigation.content,
						unit.unitId,
						"haftara",
					)}
					onNavigate={(kind, slug) =>
						contentNavigation.navigate(
							unit.unitId,
							"haftara",
							kind,
							slug,
						)
					}
					fallbackPerekId={
						unit.haftarot[0]?.ranges[0]?.start.perekId ??
						unit.ranges[0]?.start.perekId ??
						0
					}
					titles={{
						perushim: "פרשנים על ההפטרה",
						articles: "מאמרים על ההפטרה",
						perushEmpty: "אין פרשנות להפטרה זו",
						articleEmpty: "אין מאמרים להפטרה זו",
					}}
					scrollStorageKey={`parasha-${unit.unitId}-haftara`}
					perushTitle={(name) =>
						parashaPerushDocumentTitle(name, unit.name, true)
					}
					onContentTitle={setInBookContentTitle}
				/>
			</React.Fragment>,
		];
	});

	return (
		<UnitSeferBook
			seferName={seferName}
			coverSubtitle="פרשה על הפרק"
			coverEdition="קריאת התורה וההפטרה"
			contentPages={contentPages}
			contentOffset={PARASHA_CONTENT_OFFSET}
			pageSemantics={pageSemantics}
			historyMapper={historyMapper}
			initialTurnedLeaves={initialTurnedLeaves}
			of={toLetters(units.length)}
			mouseModeStorageKey="parasha-sefer-mouse-book-mode"
			pageIndicatorLabel="עבור לפרשה (מספר עברי)"
			requestedPage={requestedPage}
			isVisible={isVisible}
			onPageFlipped={handlePageFlipped}
		/>
	);
};

export default ParashaSefer;
