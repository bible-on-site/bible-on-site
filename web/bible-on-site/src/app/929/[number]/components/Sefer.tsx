"use client";
import { toLetters, toNumber } from "gematry";
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
import React, { useCallback, useMemo, useRef, useState } from "react";
import { downloadPageRanges, downloadSefer } from "@/app/929/[number]/actions";
import { BookshelfModal } from "@/app/components/Bookshelf";
import { isQriDifferentThanKtiv } from "@/data/db/tanah-view-types";
import type { PerekObj } from "@/data/perek-dto";
import { getSeferColor } from "@/data/sefer-colors";
import { getSeferByName } from "@/data/sefer-dto";
import type { Article } from "@/lib/articles";
import type { PerushSummary } from "@/lib/perushim";
import { constructTsetAwareHDate } from "@/util/hebdates-util";
import { BlankPageContent } from "./BlankPageContent";
import { Ptuah } from "./Ptuha";
import { Stuma } from "./Stuma";
import styles from "./sefer.module.css";
import "html-flip-book-react/styles.css";
import "./sefer.css";

/**
 * Converts a number to Hebrew letters with proper punctuation:
 * - Single letter: adds geresh (א', ב')
 * - Multiple letters: adds gershaim (י״א, כ״ג)
 */
function toHebrewWithPunctuation(num: number): string {
	const letters = toLetters(num, { addQuotes: true });
	// If no gershaim present and it's a single Hebrew letter, add geresh
	if (!letters.includes('"') && letters.length === 1) {
		return `${letters}'`;
	}
	return letters;
}

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
	articles: Article[];
	articlesByPerekIndex?: Article[][];
	perushimByPerekIndex?: PerushSummary[][];
	perekIds?: number[];
	initialSlug?: string;
}) => {
	const { perekObj, articles, articlesByPerekIndex, perushimByPerekIndex, perekIds, initialSlug } = props;
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

	// Page layout: cover(0), cover-interior(1), TOC(2), then per-perek
	// pairs (content, blank), then back cover.  The TOC adds 2 pages
	// before content so every perek index is offset by +2 from the old
	// formula: contentPageIndex = perekNum * 2 + 1  (1-based perekNum)
	const CONTENT_OFFSET = 3; // first content page index (after cover, interior, toc)
	const hePageSemantics: PageSemantics = useMemo(
		() => ({
			indexToSemanticName(pageIndex: number): string {
				if (pageIndex < CONTENT_OFFSET) return "";
				const adjusted = pageIndex - CONTENT_OFFSET;
				if (adjusted % 2 !== 0) return ""; // blank page
				const perekNum = adjusted / 2 + 1;
				if (perekNum > perakim.length) return "";
				return toHebrewWithPunctuation(perekNum);
			},
			semanticNameToIndex(semanticPageName: string): number | null {
				const num = toNumber(semanticPageName);
				if (num === 0) return null;
				if (num > perakim.length) return null;
				return (num - 1) * 2 + CONTENT_OFFSET;
			},
			indexToTitle(pageIndex: number): string {
				if (pageIndex < CONTENT_OFFSET) return "";
				const adjusted = pageIndex - CONTENT_OFFSET;
				if (adjusted % 2 !== 0) return "";
				const perekIdx = adjusted / 2;
				if (perekIdx >= perakim.length) return "";
				const perek = perakim[perekIdx];
				// Use the perek header from the local ts-json db (e.g. "מפקד בני ישראל...")
				// with a fallback to "פרק X" if header is missing
				return perek.header || `פרק ${toHebrewWithPunctuation(perekIdx + 1)}`;
			},
		}),
		[perakim],
	);

	const historyMapper: HistoryMapper | undefined = useMemo(
		() => ({
		pageToRoute: (pageIndex) => {
			// Non-content pages (cover, cover-interior, TOC) have no
			// meaningful URL.  Return null to tell the library to skip
			// the pushState entirely — avoids triggering framework-level
			// routing side-effects.
			if (pageIndex < CONTENT_OFFSET) return null;
			const perekIdx = Math.floor((pageIndex - CONTENT_OFFSET) / 2);
			const clampedIdx = Math.min(perekIdx, (perekIds?.length ?? 1) - 1);
			const id = perekIds?.[clampedIdx];
			if (id == null) return null;
			return `/929/${id}?book`;
		},
			routeToPage: (route) => {
				// Only resolve perekId when the route contains ?book (sefer-view mode).
				if (route.includes("?book")) {
					const m = route.match(/\/929\/(\d+)/);
					if (m) {
						const id = Number.parseInt(m[1], 10);
						const idx = perekIds?.indexOf(id) ?? -1;
						if (idx >= 0) return idx * 2 + CONTENT_OFFSET;
					}
				}
				// Backward compat: handle old #page/{hebrewLetter} bookmarks
				const hashMatch = route.match(/#page\/(.+)/);
				if (hashMatch) {
					return hePageSemantics.semanticNameToIndex(hashMatch[1]);
				}
				return null;
			},
		}),
		[perekIds, hePageSemantics],
	);

	const initialTurnedLeaves = useMemo(() => {
		// Derive the initial position from perekObj.perekId directly.
		const idx = perekIds?.indexOf(perekObj.perekId) ?? -1;
		if (idx < 0) return undefined;
		const pageIndex = idx * 2 + CONTENT_OFFSET; // content page (accounts for TOC offset)
		const turnedCount = Math.ceil(pageIndex / 2);
		return Array.from({ length: turnedCount }, (_, i) => i);
	}, [perekIds, perekObj.perekId]);

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
							const pasukElement = pasuk.segments.map((segment, segmentIdx) => {
								const segmentKey = `${pasukIdx + 1}-${segmentIdx + 1}`;
								const isQriWithDifferentKtiv =
									segment.type === "qri" && isQriDifferentThanKtiv(segment);
								// TODO: merge qris sequnce like in 929/406
								return (
									<React.Fragment key={segmentKey}>
										<span className={isQriWithDifferentKtiv ? styles.qri : ""}>
											{segment.type === "ktiv" ? (
												segment.value
											) : segment.type === "qri" ? (
												isQriWithDifferentKtiv ? (
													<>
														(
														{/* biome-ignore lint/a11y/noLabelWithoutControl: It'll take some time to validate this fix altogether with css rules */}
														<label />
														{segment.value})
													</>
												) : (
													segment.value
												)
											) : segment.type === "ptuha" ? (
												Ptuah()
											) : (
												Stuma()
											)}
										</span>
										{segmentIdx === pasuk.segments.length - 1 ||
										((segment.type === "ktiv" || segment.type === "qri") &&
											segment.value.at(segment.value.length - 1) ===
												"־") ? null : (
											<span> </span>
										)}
									</React.Fragment>
								);
							});
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
			articles={articlesByPerekIndex?.[perekIdx] ?? articles}
			perushim={perushimByPerekIndex?.[perekIdx] ?? []}
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
							onDownloadSefer: async () => {
								const r = await downloadSefer();
								return "error" in r ? null : { ext: r.ext, data: r.data };
							},
							onDownloadPageRange: async (pages, semanticPages, context) => {
								const r = await downloadPageRanges(pages, semanticPages, context);
								return "error" in r ? null : { ext: r.ext, data: r.data };
							},
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
