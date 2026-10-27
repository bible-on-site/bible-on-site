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
import {
	type UnitBookContentKind,
	unitBookContentSlug,
} from "@/app/components/reading/unit-book-content";
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
	buildMasoraDocumentTitleResolver,
	buildMasoraHistoryMapper,
	buildMasoraPageSemantics,
	computeMasoraInitialTurnedLeaves,
	MASORA_CONTENT_OFFSET,
	MASORA_ROOT,
	MASORA_ROOT_ALIASES,
	masoraBookPageRoute,
	type MasoraBookUnit,
	masoraPerushDocumentTitle,
	masoraUnitDocumentTitle,
} from "./masora-book-utils";

/**
 * The מסורה sefer book: a flipbook over one sefer sliced by Masoretic
 * (פתוחה/סתומה) parashot — never conventional perakim. Each unit gets a
 * text page (its range-scoped scripture, headed by its reference-span
 * heading and closing-break marker) followed by a blank commentary page
 * bounded to the same ranges, so contents, navigation, history, and
 * commentary all follow the selected division.
 */
const MasoraSefer = (props: {
	units: MasoraBookUnit[];
	seferName: string;
	currentUnitId: number;
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
	perekSources: Record<number, string>;
	perekById: Map<number, Perek>;
	/** Current unit's SSG carousel data (other units load lazily). */
	articles: ArticleSummary[];
	perushim: RangePerushSummary[];
	initialBookPage: BookPage | null;
	initialContent?: {
		scope: "torah";
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
		initialBookPage,
		initialContent,
		isVisible = true,
	} = props;

	const contentNavigation = useUnitBookContentNavigation(
		MASORA_ROOT,
		MASORA_ROOT_ALIASES,
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
		() => buildMasoraPageSemantics(units),
		[units],
	);
	const historyMapper = useMemo(() => buildMasoraHistoryMapper(units), [units]);
	const initialTurnedLeaves = useMemo(
		() =>
			initialBookPage === "front"
				? []
				: initialBookPage === "toc"
					? [0]
					: initialBookPage === "back"
						? Array.from({ length: units.length + 2 }, (_, i) => i)
						: computeMasoraInitialTurnedLeaves(units, currentUnitId),
		[initialBookPage, units, currentUnitId],
	);

	// One-time batch fetch of article/perushim summaries for all units
	// except the current one (which has SSG data), bounded to each
	// unit's own ranges.
	const [batchSummaries, setBatchSummaries] = useState<
		Record<string, UnitBookSummaries>
	>({});
	useEffect(() => {
		const idsToFetch = units
			.map((unit) => unit.unitId)
			.filter((id) => id !== currentUnitId);
		if (idsToFetch.length === 0) return;
		getUnitScopeSummariesBatch("masora", idsToFetch, "torah")
			.then(setBatchSummaries)
			.catch((error) => {
				console.error("Failed to load masora book summaries", {
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
	const backCoverPageIndex = MASORA_CONTENT_OFFSET + units.length * 2;
	const documentTitleResolver = useMemo(
		() =>
			buildMasoraDocumentTitleResolver(
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
	const flatPageTitle = masoraUnitDocumentTitle(
		units.find((unit) => unit.unitId === currentUnitId)?.heading ?? "",
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
			? masoraBookPageRoute(units[0]?.unitId ?? 0, initialBookPage)
			: `${MASORA_ROOT}/${currentUnitId}?book`,
	);

	const contentPages = units.flatMap((unit) => {
		const bookKey = unitBookKey(unit.unitId, "torah");
		const summaries =
			unit.unitId === currentUnitId
				? { articles, perushim }
				: batchSummaries[String(unit.unitId)];
		const unitPath = `${MASORA_ROOT}/${unit.unitId}`;
		return [
			<React.Fragment key={`masora-${unit.unitId}`}>
				<section
					className={`${seferStyles.pageContentPage} flipbook-page-bounded`}
					data-sefer-unit-text={bookKey}
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
						<span>{unit.heading}</span>
						{unit.closingBreak && (
							<span className={unitPageStyles.closingBreak}>
								{unit.closingBreak === "ptuha"
									? "פרשה פתוחה"
									: "פרשה סתומה"}
							</span>
						)}
					</div>
					{/* Pasuk-numeral clicks navigate the facing open perush;
						the delegated handler no-ops everywhere else. */}
					{/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: delegated pasuk-number navigation — the real targets carry data-pasuk-num and are pointer-only text numerals */}
					<div
						className={seferStyles.perekTextScrollWrapper}
						onClick={(event) =>
							handleUnitTextPasukClick(bookKey, event.target)
						}
					>
						<article className={seferStyles.perekText}>
							<UnitTextBody
								ranges={unit.ranges}
								entityRefsByPerek={entityRefsByPerek}
								pasukCount={pasukCount}
								resolvePerek={resolvePerek}
								/* Book-side anchors carry a unit-unique scope so they
								 * never duplicate the flat page's canonical
								 * pasuk-{perek}-{pasuk} ids — a mounted book
								 * must not shadow the flat anchors' getElementById
								 * resolution (boundary pesukim appear in two
								 * adjacent units, so the unit id scopes them). */
								anchorScope={`book-${unit.unitId}`}
							/>
						</article>
					</div>
				</section>
			</React.Fragment>,
			<React.Fragment key={`blank-${unit.unitId}`}>
				<UnitBlankPageContent
					division="masora"
					unitId={unit.unitId}
					scope="torah"
					unitPath={unitPath}
					articles={summaries?.articles ?? []}
					perushim={summaries?.perushim ?? []}
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
					scrollStorageKey={`masora-${unit.unitId}`}
					perushTitle={(name) =>
						masoraPerushDocumentTitle(name, unit.heading)
					}
					onContentTitle={setInBookContentTitle}
				/>
			</React.Fragment>,
		];
	});

	return (
		<UnitSeferBook
			seferName={seferName}
			coverSubtitle="מסורה על הפרק"
			coverEdition="פרשיות פתוחות וסתומות"
			contentPages={contentPages}
			contentOffset={MASORA_CONTENT_OFFSET}
			pageSemantics={pageSemantics}
			historyMapper={historyMapper}
			initialTurnedLeaves={initialTurnedLeaves}
			of={toLetters(units.length)}
			mouseModeStorageKey="masora-sefer-mouse-book-mode"
			pageIndicatorLabel="עבור לפרשה (מספר עברי)"
			requestedPage={requestedPage}
			isVisible={isVisible}
			onPageFlipped={handlePageFlipped}
		/>
	);
};

export default MasoraSefer;
