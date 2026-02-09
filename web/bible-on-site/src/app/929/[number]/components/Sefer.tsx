"use client";
import { toLetters, toNumber } from "gematry";
import type {
	CoverConfig,
	FlipBookHandle,
	PageSemantics,
} from "html-flip-book-react";
import {
	ActionButton,
	BookshelfIcon,
	DownloadDropdown,
	FirstPageButton,
	LastPageButton,
	NextButton,
	PageIndicator,
	PrevButton,
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
	/** Cover configuration */
	coverConfig?: CoverConfig;
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
}) => {
	const { perekObj, articles, articlesByPerekIndex, perushimByPerekIndex, perekIds } = props;
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

	// Pages: cover, then for each perek (content page, blank for future perushim/articles), then back cover.
	const hePageSemantics: PageSemantics = useMemo(
		() => ({
			indexToSemanticName(pageIndex: number): string {
				if (pageIndex <= 0 || pageIndex % 2 === 0) return "";
				const perekNum = (pageIndex + 1) / 2;
				if (perekNum > perakim.length) return "";
				return toHebrewWithPunctuation(perekNum);
			},
			semanticNameToIndex(semanticPageName: string): number | null {
				const num = toNumber(semanticPageName);
				if (num === 0) return null;
				if (num > perakim.length) return null;
				return 2 * num - 1;
			},
			indexToTitle(pageIndex: number): string {
				if (pageIndex <= 0 || pageIndex % 2 === 0) return "";
				const perekNum = (pageIndex + 1) / 2;
				if (perekNum > perakim.length) return "";
				return `פרק ${toHebrewWithPunctuation(perekNum)}`;
			},
		}),
		[perakim.length],
	);

	const coverStyle = { backgroundColor: seferColor };
	const frontCover = (
		<section
			className={styles.page}
			aria-label="עטיפה קדמית"
			style={coverStyle}
		>
			<div className={styles.coverContent}>
				<h1 className={styles.coverTitle}>ספר {perekObj.sefer}</h1>
				<p className={styles.coverSubtitle}>
					מקראות גדולות עם מאמרים מרבנים בני זמנינו
				</p>
			</div>
		</section>
	);
	const backCover = (
		<section
			className={styles.page}
			aria-label="עטיפה אחורית"
			style={coverStyle}
		>
			{/* Back cover intentionally left empty */}
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
			/>
		</React.Fragment>,
	]);

	const pages = [frontCover, ...contentPages, backCover];

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
						coverConfig={{
							hardCovers: true,
							noShadow: true,
							coverIndices: "auto",
						}}
					/>
				</div>
			<Toolbar
				flipBookRef={flipBookRef}
				direction="rtl"
				pageSemantics={hePageSemantics}
			>
				<ActionButton onClick={openBookshelf} ariaLabel="ספרי התנ״ך">
					<BookshelfIcon size={18} />
				</ActionButton>
				<DownloadDropdown
					ariaLabel="הורדה"
					entireBookFilename={perekObj.sefer}
					rangeFilename={perekObj.sefer}
					downloadContext={{ seferName: perekObj.sefer }}
					onDownloadSefer={async () => {
						const r = await downloadSefer();
						return "error" in r ? null : { ext: r.ext, data: r.data };
					}}
					onDownloadPageRange={async (pages, semanticPages, context) => {
						const r = await downloadPageRanges(pages, semanticPages, context);
						return "error" in r ? null : { ext: r.ext, data: r.data };
					}}
				/>
				<FirstPageButton />
				<PrevButton />
				<PageIndicator ariaLabel="עבור לפרק (מספר עברי)" />
				<NextButton />
				<LastPageButton />
			</Toolbar>
			</div>
			<BookshelfModal isOpen={isBookshelfOpen} onClose={closeBookshelf} />
		</>
	);
};

export default Sefer;
