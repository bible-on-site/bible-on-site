"use client";
import { toLetters } from "gematry";
import type {
	CoverConfig,
	FlipBookHandle,
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
import React, { useMemo, useRef, useState } from "react";
import { BookshelfModal } from "@/app/components/Bookshelf";
import type { Perek } from "@/data/db/tanah-view-types";
import { getSeferColor } from "@/data/sefer-colors";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import { UnitTextBody } from "@/app/components/reading/UnitTextBody";
import seferStyles from "@/app/929/[number]/components/sefer.module.css";
import unitPageStyles from "../page.module.css";
import {
	type BookPage,
	buildParashaHistoryMapper,
	buildParashaPageSemantics,
	computeParashaInitialTurnedLeaves,
	PARASHA_CONTENT_OFFSET,
	parashaBookPageRoute,
	type ParashaBookUnit,
} from "./parasha-book-utils";
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
	historyMapper?: ReturnType<typeof buildParashaHistoryMapper>;
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

/**
 * The פרשה sefer book: a flipbook over one Torah sefer sliced by
 * parashiot. Each parasha gets a Torah page followed by a Haftarah page
 * (all custom variants in order), so the whole weekly reading sits
 * inside the book chrome — TOC and URL history cover both halves.
 */
const ParashaSefer = (props: {
	units: ParashaBookUnit[];
	seferName: string;
	currentUnitId: number;
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
	perekSources: Record<number, string>;
	perekById: Map<number, Perek>;
	initialBookPage: BookPage | null;
	haftara: boolean;
}) => {
	const {
		units,
		seferName,
		currentUnitId,
		entityRefsByPerek,
		perekSources,
		perekById,
		initialBookPage,
		haftara,
	} = props;
	const flipBookRef = useRef<FlipBookHandle>(null);
	const bookWrapperRef = useRef<HTMLDivElement>(null);
	const seferColor = getSeferColor(seferName);
	const [isBookshelfOpen, setIsBookshelfOpen] = useState(false);

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
						? Array.from({ length: units.length + 2 }, (_, i) => i)
						: computeParashaInitialTurnedLeaves(units, currentUnitId, haftara),
		[initialBookPage, units, currentUnitId, haftara],
	);

	// Router navigation to another book URL keeps this instance; move to
	// the requested spread without pushing a duplicate history entry.
	const requestedPage = historyMapper.routeToPage(
		initialBookPage
			? parashaBookPageRoute(seferName, initialBookPage)
			: `/פרשה/${currentUnitId}?book${haftara ? "&haftara" : ""}`,
	);
	React.useEffect(() => {
		const book = flipBookRef.current;
		if (
			book &&
			requestedPage != null &&
			requestedPage !== book.getCurrentPageIndex()
		) {
			book.restorePage(requestedPage);
		}
	}, [requestedPage]);

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
					<p className={seferStyles.coverSubtitle}>פרשה על הפרק</p>
					<p className={seferStyles.coverEdition}>קריאת התורה וההפטרה</p>
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

	const contentPages = units.flatMap((unit) => [
		<React.Fragment key={`parasha-${unit.unitId}`}>
			<section className={seferStyles.pageContentPage}>
				<div className={seferStyles.pageHeaderRight}>
					<div className={seferStyles.pageHeaderRow}>
						<span className={seferStyles.pageHeaderSefer}>{seferName}</span>
						<span className={seferStyles.pageHeaderPerek}>
							{toLetters(unit.order)}
						</span>
					</div>
				</div>
				<div className={seferStyles.pageHeaderLeft}>
					<span>{`פרשת ${unit.name}`}</span>
					<span>{unit.refSpan}</span>
				</div>
				<div className={seferStyles.perekTextScrollWrapper}>
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
		<React.Fragment key={`haftara-${unit.unitId}`}>
			<section className={seferStyles.pageContentPage}>
				<div className={seferStyles.pageHeaderRight}>
					<div className={seferStyles.pageHeaderRow}>
						<span className={seferStyles.pageHeaderSefer}>{seferName}</span>
						<span className={seferStyles.pageHeaderPerek}>
							{toLetters(unit.order)}
						</span>
					</div>
				</div>
				<div className={seferStyles.pageHeaderLeft}>
					<span>{`הפטרת ${unit.name}`}</span>
				</div>
				<div className={seferStyles.perekTextScrollWrapper}>
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
	]);

	// cover + cover-interior + TOC + (units * 2) + backCover
	const totalPages = PARASHA_CONTENT_OFFSET + units.length * 2 + 1;

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
				entry.pageIndex >= PARASHA_CONTENT_OFFSET && entry.title.length > 0
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
						ref={flipBookRef}
						className="he-book"
						mouseModeStorageKey="parasha-sefer-mouse-book-mode"
						pages={pages}
						pageSemantics={pageSemantics}
						direction="rtl"
						leavesBuffer={7}
						of={toLetters(units.length)}
						tocPageIndex={2}
						coverConfig={{
							hardCovers: true,
							noShadow: true,
							coverIndices: "auto",
						}}
						pageShadow={false}
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
						<PageIndicator ariaLabel="עבור לפרשה (מספר עברי)" />
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
};

export default ParashaSefer;
