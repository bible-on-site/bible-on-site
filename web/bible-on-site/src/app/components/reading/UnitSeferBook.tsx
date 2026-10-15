"use client";

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
	FirstPageButton,
	FullscreenButton,
	LastPageButton,
	MouseModeButton,
	NextButton,
	PageIndicator,
	PrevButton,
	TocButton,
	Toolbar,
} from "html-flip-book-react/toolbar";
import dynamic from "next/dynamic";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { BookshelfModal } from "@/app/components/Bookshelf";
import { getSeferColor } from "@/data/sefer-colors";
import seferStyles from "@/app/929/[number]/components/sefer.module.css";
import "html-flip-book-react/styles.css";
import "@/app/929/[number]/components/sefer.css";

/** Props we pass to FlipBook; matches html-flip-book-react FlipBookProps for typing dynamic() */
type FlipBookProps = {
	handlers?: { onPageFlipping?: () => void; onPageFlipped?: () => void };
	className: string;
	pages: React.ReactNode[];
	pageSemantics?: PageSemantics;
	direction?: "rtl" | "ltr";
	leavesBuffer?: number;
	of?: string | number;
	coverConfig?: CoverConfig;
	historyMapper?: HistoryMapper;
	initialTurnedLeaves?: number[];
	pageShadow?: boolean;
	snapshotDuringFlip?: boolean;
	tocPageIndex?: number;
	mouseModeStorageKey?: string;
};

const FlipBook = dynamic<
	FlipBookProps & { ref?: React.RefObject<FlipBookHandle | null> }
>(() => import("html-flip-book-react").then((mod) => mod.FlipBook), {
	ssr: false,
});

const FRONT_COVER_INDEX = 0;
const COVER_INTERIOR_INDEX = 1;
const TOC_PAGE_INDEX = 2;

export interface UnitSeferBookProps {
	seferName: string;
	/** Cover subtitle naming the division (e.g. "מסורה על הפרק"). */
	coverSubtitle: string;
	/** Second cover line describing the division's slicing. */
	coverEdition?: string;
	/**
	 * Unit-driven content pages, in book order (each unit's text page
	 * and its blank commentary page). Everything else — covers,
	 * contents, toolbar, visibility markers — is shared chrome.
	 */
	contentPages: React.ReactNode[];
	/** Page index where unit pages start (covers + TOC precede them). */
	contentOffset: number;
	pageSemantics: PageSemantics;
	historyMapper: HistoryMapper;
	initialTurnedLeaves?: number[];
	/** Total-count display in the toolbar (Hebrew numeral of units). */
	of: string | number;
	mouseModeStorageKey: string;
	/** PageIndicator aria label — names the division unit, never "פרק". */
	pageIndicatorLabel: string;
	/** A route-driven page the book should restore without a history write. */
	requestedPage?: number | null;
	/** Whether the reader is shown; while hidden the document scroll lock releases. */
	isVisible?: boolean;
	/** Called with the committed page index right before the history write. */
	onPageFlipped?: (pageIndex: number) => void;
}

/**
 * Shared flipbook chrome of the alternative-division sefer books
 * (issue #2191): the same html-flip-book-react reader surface the /929
 * Sefer view runs — covers, contents page, toolbar, bookshelf, scroll
 * lock, and route restoration — while the selected division supplies
 * the unit-driven pages, semantics, and history through props. Nothing
 * here assumes conventional perakim: page identity flows entirely from
 * the division's pageSemantics and historyMapper.
 */
export function UnitSeferBook({
	seferName,
	coverSubtitle,
	coverEdition,
	contentPages,
	contentOffset,
	pageSemantics,
	historyMapper,
	initialTurnedLeaves,
	of,
	mouseModeStorageKey,
	pageIndicatorLabel,
	requestedPage,
	isVisible = true,
	onPageFlipped,
}: UnitSeferBookProps) {
	const flipBookRef = useRef<FlipBookHandle>(null);
	const bookWrapperRef = useRef<HTMLDivElement>(null);
	const seferColor = getSeferColor(seferName);
	const [isBookshelfOpen, setIsBookshelfOpen] = useState(false);

	// Router navigation to another book URL keeps this instance; move to
	// the requested spread without pushing a duplicate history entry.
	useEffect(() => {
		const book = flipBookRef.current;
		if (
			book &&
			requestedPage != null &&
			requestedPage !== book.getCurrentPageIndex()
		) {
			book.restorePage(requestedPage);
		}
	}, [requestedPage]);

	// While the reader is shown, mark the document so the scroll lock in
	// sefer.css confines scrolling to the book's inner panes (issue #2178).
	// The host overlay keeps this component mounted after the book closes,
	// so the attribute must track visibility — not mere mount — to release
	// the page's scrolling when the reader is hidden or unmounted.
	useEffect(() => {
		if (!isVisible) {
			delete document.documentElement.dataset.seferView;
			return;
		}
		document.documentElement.dataset.seferView = "";
		return () => {
			delete document.documentElement.dataset.seferView;
		};
	}, [isVisible]);

	const totalPages = contentOffset + contentPages.length + 1;

	const frontCover = (
		<section
			key="front-cover"
			className={`${seferStyles.page} ${seferStyles.cover}`}
			aria-label="עטיפה קדמית"
			style={{ "--cover-color": seferColor } as React.CSSProperties}
		>
			<div className={seferStyles.coverInner}>
				<div className={seferStyles.coverContent}>
					<div className={seferStyles.coverOrnament}>✦</div>
					<h1 className={seferStyles.coverTitle}>ספר {seferName}</h1>
					<div className={seferStyles.coverDivider} />
					<p className={seferStyles.coverSubtitle}>{coverSubtitle}</p>
					{coverEdition && (
						<p className={seferStyles.coverEdition}>{coverEdition}</p>
					)}
				</div>
			</div>
		</section>
	);
	const backCover = (
		<section
			key="back-cover"
			className={`${seferStyles.page} ${seferStyles.cover}`}
			aria-label="עטיפה אחורית"
			style={{ "--cover-color": seferColor } as React.CSSProperties}
		>
			<div className={seferStyles.coverInner} />
		</section>
	);

	const tocPage = (
		<TocPage
			key="toc"
			onNavigate={(pageIndex) => flipBookRef.current?.jumpToPage(pageIndex)}
			totalPages={totalPages}
			pageSemantics={pageSemantics}
			getHref={(entry) =>
				historyMapper.pageToRoute(entry.pageIndex, {
					semanticName: entry.semanticName,
					title: entry.title,
				})
			}
			heading="תוכן העניינים"
			direction="rtl"
			filter={(entry) =>
				entry.pageIndex >= contentOffset && entry.title.length > 0
			}
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
			<div className={seferStyles.bookWrapper} dir="rtl" ref={bookWrapperRef}>
				<div className={seferStyles.bookArea}>
					<FlipBook
						handlers={{
							onPageFlipped: () => {
								const pageIndex =
									flipBookRef.current?.getCurrentPageIndex();
								if (pageIndex != null) onPageFlipped?.(pageIndex);
							},
						}}
						ref={flipBookRef}
						className="he-book"
						mouseModeStorageKey={mouseModeStorageKey}
						pages={pages}
						pageSemantics={pageSemantics}
						direction="rtl"
						leavesBuffer={7}
						of={of}
						tocPageIndex={TOC_PAGE_INDEX}
						coverConfig={{
							hardCovers: true,
							noShadow: true,
							coverIndices: "auto",
						}}
						pageShadow
						historyMapper={historyMapper}
						initialTurnedLeaves={initialTurnedLeaves}
					/>
				</div>
				<Toolbar
					flipBookRef={flipBookRef}
					direction="rtl"
					pageSemantics={pageSemantics}
					fullscreenTargetRef={bookWrapperRef}
				>
					<div className="flipbook-toolbar-start">
						<FullscreenButton />
						<TocButton />
						<MouseModeButton />
						<ActionButton
							onClick={() => setIsBookshelfOpen(true)}
							ariaLabel={'ספרי התנ"ך'}
						>
							<BookshelfIcon size={18} />
						</ActionButton>
					</div>
					<div className="flipbook-toolbar-nav-cluster">
						<FirstPageButton />
						<PrevButton />
						<PageIndicator ariaLabel={pageIndicatorLabel} />
						<NextButton />
						<LastPageButton />
					</div>
				</Toolbar>
			</div>
			<BookshelfModal
				isOpen={isBookshelfOpen}
				onClose={() => setIsBookshelfOpen(false)}
			/>
		</>
	);
}

export { FRONT_COVER_INDEX, COVER_INTERIOR_INDEX, TOC_PAGE_INDEX };
