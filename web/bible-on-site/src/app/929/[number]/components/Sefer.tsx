"use client";
import { toLetters } from "gematry";
import type {
	CoverConfig,
	FlipBookHandle,
	HistoryMapper,
	PageSemantics,
} from "html-flip-book-react";
import { TocPage } from "html-flip-book-react";
import {
	ActionButton,
	BookshelfIcon,
	type DownloadConfig,
	DownloadDropdown,
	FirstPageButton,
	FullscreenButton,
	LastPageButton,
	NextButton,
	PageIndicator,
	PrevButton,
	TocButton,
	Toolbar,
} from "html-flip-book-react/toolbar";
import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type PerekSummaries, downloadPageRanges, downloadSefer, getPerekSummariesBatch } from "@/app/929/[number]/actions";
import { BookshelfModal } from "@/app/components/Bookshelf";
import type { PerekObj } from "@/data/perek-dto";
import { getSeferColor } from "@/data/sefer-colors";
import { getSeferByName } from "@/data/sefer-dto";
import type { ArticleSummary } from "@/lib/articles";
import type { PerushSummary } from "@/lib/perushim";
import { buildEntityRefLookup } from "@/lib/tanahpedia/entity-ref-lookup";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import { constructTsetAwareHDate } from "@/util/hebdates-util";
import { BlankPageContent } from "./BlankPageContent";
import { Ptuah } from "./Ptuha";
import { Stuma } from "./Stuma";
import { TanahpediaLink } from "./TanahpediaLink";
import { renderPasukWithEntityRefs } from "./pasuk-renderer";
import {
	CONTENT_OFFSET,
	buildHistoryMapper,
	buildPageSemantics,
	computeInitialTurnedLeaves,
	toHebrewWithPunctuation,
	wrapDownloadResult,
} from "./sefer-page-utils";
import styles from "./sefer.module.css";
import "html-flip-book-react/styles.css";
import "./sefer.css";

/** Props we pass to FlipBook; matches html-flip-book-react FlipBookProps for typing dynamic() */
type FlipBookProps = {
	className: string;
	pages: React.ReactNode[];
	pageSemantics?: PageSemantics;
	direction?: "rtl" | "ltr";
	/** Leaves to keep visible before/after current for performance */
	leavesBuffer?: number;
	/** Override total-page display in toolbar (e.g. Hebrew chapter count) */
	of?: string | number;
	/** Cover configuration */
	coverConfig?: CoverConfig;
	/** History integration: URL ↔ page */
	historyMapper?: HistoryMapper;
	/** Initial turned leaves (from URL on load) – array of leaf indices */
	initialTurnedLeaves?: number[];
	/** Download configuration: entire book and page-range handlers plus filename hints */
	downloadConfig?: DownloadConfig;
	/** Enable/disable page shadow effect during flip */
	pageShadow?: boolean;
	/** Aggressive containment during flip animations for reduced jank */
	snapshotDuringFlip?: boolean;
	/** Table of contents page index (book-level). Default: 4. */
	tocPageIndex?: number;
};

/** Dynamic FlipBook with ref forwarded (library uses forwardRef) */
const FlipBook = dynamic<
	FlipBookProps & { ref?: React.RefObject<FlipBookHandle | null> }
>(() => import("html-flip-book-react").then((mod) => mod.FlipBook), {
	ssr: false,
});

const Sefer = (props: {
	perekObj: PerekObj;
	articles: ArticleSummary[];
	perushim: PerushSummary[];
	perekIds?: number[];
	entityRefsByPerek?: Record<number, PerekEntityReference[]>;
	initialSlug?: string;
}) => {
	const { perekObj, articles, perushim, perekIds, entityRefsByPerek, initialSlug } = props;
	const sefer = getSeferByName(perekObj.sefer);
	const flipBookRef = useRef<FlipBookHandle>(null);
	const bookWrapperRef = useRef<HTMLDivElement>(null);
	const seferColor = getSeferColor(perekObj.sefer);
	const [isBookshelfOpen, setIsBookshelfOpen] = useState(false);
	const perakim =
		"perakim" in sefer
			? sefer.perakim
			: sefer.additionals.flatMap((additional) => additional.perakim);

	const openBookshelf = useCallback(() => setIsBookshelfOpen(true), []);
	const closeBookshelf = useCallback(() => setIsBookshelfOpen(false), []);

	const entityRefLookupsByPerekIdx = useMemo(() => {
		if (!entityRefsByPerek || !perekIds) return {};
		const result: Record<number, ReturnType<typeof buildEntityRefLookup>> = {};
		for (let i = 0; i < perekIds.length; i++) {
			const refs = entityRefsByPerek[perekIds[i]];
			if (refs && refs.length > 0) {
				result[i] = buildEntityRefLookup(refs);
			}
		}
		return result;
	}, [entityRefsByPerek, perekIds]);

	const perekHeaders = useMemo(
		() => perakim.map((p) => p.header),
		[perakim],
	);
	const hePageSemantics: PageSemantics = useMemo(
		() => buildPageSemantics(perakim.length, perekHeaders),
		[perakim.length, perekHeaders],
	);

	const historyMapper: HistoryMapper | undefined = useMemo(
		() => buildHistoryMapper(perekIds, hePageSemantics),
		[perekIds, hePageSemantics],
	);

	const initialTurnedLeaves = useMemo(
		() => computeInitialTurnedLeaves(perekIds, perekObj.perekId),
		[perekIds, perekObj.perekId],
	);

	const frontCover = (
		<section
			className={`${styles.page} ${styles.cover}`}
			aria-label="עטיפה קדמית"
			style={{ "--cover-color": seferColor } as React.CSSProperties}
		>
			<div className={styles.coverInner}>
				<div className={styles.coverContent}>
					<div className={styles.coverOrnament}>✦</div>
					<h1 className={styles.coverTitle}>ספר {perekObj.sefer}</h1>
					<div className={styles.coverDivider} />
					<p className={styles.coverSubtitle}>
						מקראות גדולות
					</p>
					<p className={styles.coverEdition}>
						עם מאמרים מרבנים בני זמנינו
					</p>
				</div>
			</div>
		</section>
	);
	const backCover = (
		<section
			className={`${styles.page} ${styles.cover}`}
			aria-label="עטיפה אחורית"
			style={{ "--cover-color": seferColor } as React.CSSProperties}
		>
			<div className={styles.coverInner} />
		</section>
	);

	const hebrewDateStr = useMemo(
		() => constructTsetAwareHDate(new Date()).toTraditionalHebrewString(),
		[],
	);

	// Index of the current perek within the sefer, used to map SSG-provided data
	const currentPerekIdx = useMemo(
		() => perekIds?.indexOf(perekObj.perekId) ?? -1,
		[perekIds, perekObj.perekId],
	);

	// One-time batch fetch of article/perushim summaries for all perakim
	// except the current one (which has SSG data). Keyed by perekId string.
	const [batchSummaries, setBatchSummaries] = useState<Record<string, PerekSummaries>>({});
	useEffect(() => {
		const idsToFetch = perekIds?.filter((id) => id !== perekObj.perekId) ?? [];
		if (idsToFetch.length === 0) return;
		getPerekSummariesBatch(idsToFetch).then(setBatchSummaries).catch(() => {});
	}, [perekIds, perekObj.perekId]);

	const contentPages = perakim.flatMap((perek, perekIdx) => [
		<React.Fragment key={`perek-${perekIdx + 1}`}>
			<section className={styles.pageContentPage}>
				<div className={styles.pageHeaderRight}>
					<div className={styles.pageHeaderRow}>
						<span className={styles.pageHeaderSefer}>{perekObj.sefer}</span>
						<span className={styles.pageHeaderPerek}>
							{toLetters(perekIdx + 1, { addQuotes: true })}
						</span>
					</div>
					<div className={styles.perekHeader} title={perek.header}>
						{perek.header}
					</div>
				</div>
				<div className={styles.perekTextScrollWrapper}>
					<article className={styles.perekText}>
						{perek.pesukim.map((pasuk, pasukIdx) => {
							const pasukKey = pasukIdx + 1;
							const pasukNumElement = (
								<span className={styles.pasukNum}>
									{toLetters(pasukIdx + 1)}
								</span>
							);
							const perekLookup = entityRefLookupsByPerekIdx[perekIdx]
								?? buildEntityRefLookup([]);
							const pasukElement = renderPasukWithEntityRefs(
								pasuk.segments,
								pasukIdx,
								perekLookup,
								Ptuah,
								Stuma,
								styles.qri,
								(entryUniqueName, children, key) => (
									<TanahpediaLink
										key={key}
										entryUniqueName={entryUniqueName}
										className={styles.tanahpediaLink}
									>
										{children}
									</TanahpediaLink>
								),
							);
							return (
								<React.Fragment key={pasukKey}>
									{pasukNumElement}
									<span> </span>
									{pasukElement}
									<span> </span>
								</React.Fragment>
							);
						})}
					</article>
				</div>
			</section>
		</React.Fragment>,
	<React.Fragment key={`blank-${perekIdx + 1}`}>
		<BlankPageContent
			articles={perekIdx === currentPerekIdx ? articles : batchSummaries[String(perekIds?.[perekIdx] ?? 0)]?.articles}
			perushim={perekIdx === currentPerekIdx ? perushim : batchSummaries[String(perekIds?.[perekIdx] ?? 0)]?.perushim}
			perekId={perekIds?.[perekIdx] ?? 0}
			hebrewDateStr={hebrewDateStr}
			initialSlug={perekIds?.[perekIdx] === perekObj.perekId ? initialSlug : undefined}
		/>
	</React.Fragment>,
	]);

	// Total pages: cover + cover-interior + TOC + (perakim * 2) + backCover
	const totalPages = 3 + perakim.length * 2 + 1;

	const tocPage = (
		<TocPage
			key="toc"
			onNavigate={(pageIndex) => flipBookRef.current?.jumpToPage(pageIndex)}
			totalPages={totalPages}
			pageSemantics={hePageSemantics}
			heading="תוכן העניינים"
			direction="rtl"
			filter={(entry) => entry.pageIndex >= CONTENT_OFFSET && entry.title.length > 0}
		/>
	);

	const pages = [
		frontCover,
		<div key="cover-interior" />,
		tocPage,
		...contentPages,
		backCover,
	];

	return (
		<>
			<div className={styles.bookWrapper} dir="rtl" ref={bookWrapperRef}>
				<div className={styles.bookArea}>
					<FlipBook
						ref={flipBookRef}
						className="he-book"
						pages={pages}
						pageSemantics={hePageSemantics}
						direction="rtl"
						leavesBuffer={7}
						of={toHebrewWithPunctuation(perakim.length)}
						tocPageIndex={2}
						coverConfig={{
							hardCovers: true,
							noShadow: true,
							coverIndices: "auto",
						}}
						pageShadow={false}
						historyMapper={historyMapper}
						initialTurnedLeaves={initialTurnedLeaves}
						downloadConfig={{
							entireBookFilename: perekObj.sefer,
							rangeFilename: perekObj.sefer,
							downloadContext: { seferName: perekObj.sefer },
							onDownloadSefer: async () =>
								wrapDownloadResult(await downloadSefer()),
							onDownloadPageRange: async (pages, semanticPages, context) =>
								wrapDownloadResult(
									await downloadPageRanges(pages, semanticPages, context),
								),
						}}
					/>
				</div>
			<Toolbar
				flipBookRef={flipBookRef}
				direction="rtl"
				pageSemantics={hePageSemantics}
				fullscreenTargetRef={bookWrapperRef}
			>
				<div className="flipbook-toolbar-start">
					<FullscreenButton />
					<TocButton />
					<ActionButton onClick={openBookshelf} ariaLabel="ספרי התנ״ך">
						<BookshelfIcon size={18} />
					</ActionButton>
				</div>
				<div className="flipbook-toolbar-nav-cluster">
					<FirstPageButton />
					<PrevButton />
					<PageIndicator ariaLabel="עבור לפרק (מספר עברי)" />
					<NextButton />
					<LastPageButton />
				</div>
				<div className="flipbook-toolbar-end">
					<DownloadDropdown ariaLabel="הורדה" />
				</div>
			</Toolbar>
			</div>
			<BookshelfModal isOpen={isBookshelfOpen} onClose={closeBookshelf} />
		</>
	);
};

export default Sefer;
