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
	MouseModeButton,
	NextButton,
	PageIndicator,
	PrevButton,
	TocButton,
	Toolbar,
} from "html-flip-book-react/toolbar";
import dynamic from "next/dynamic";
import Image from "next/image";
import { usePathname } from "next/navigation";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	downloadPageRanges,
	downloadSefer,
	getPerekSummariesBatch,
	type PerekSummaries,
} from "@/app/929/[number]/actions";
import { BookshelfModal } from "@/app/components/Bookshelf";
import type { SefarimItem } from "@/data/db/tanah-view-types";
import type { PerekObj } from "@/data/perek-dto";
import { getSeferColor } from "@/data/sefer-colors";

import type { ArticleSummary } from "@/lib/articles";
import type { PerushSummary } from "@/lib/perushim";
import type { PerekIllustration } from "@/lib/seo/perek-illustrations";
import { buildEntityRefLookup } from "@/lib/tanahpedia/entity-ref-lookup";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import { constructTsetAwareHDate } from "@/util/hebdates-util";
import { BlankPageContent } from "./BlankPageContent";
import { ImageCaption } from "./ImageCaption";
import { Ptuah } from "./Ptuha";
import { renderPasukWithEntityRefs } from "./pasuk-renderer";
import RecitationPlayer, {
	RecitationHeader,
	RecitationLink,
	RecitationPasukControl,
	RecitationVerse,
	RecitationWordControl,
	stopRecitation,
} from "./RecitationPlayer";
import { Stuma } from "./Stuma";
import styles from "./sefer.module.css";
import {
	articleDocumentTitle,
	buildSeferDocumentTitleResolver,
	buildSeferPerekTitles,
	perekDocumentTitle,
	perushDocumentTitle,
	releaseSeferDocumentTitle,
	setSeferDocumentTitle,
} from "./sefer-document-title";
import {
	type BookPage,
	bookPageRoute,
	buildHistoryMapper,
	buildPageSemantics,
	CONTENT_OFFSET,
	computeInitialTurnedLeaves,
	toHebrewChapterNumber,
	wrapDownloadResult,
} from "./sefer-page-utils";
import {
	scrollToPerushPasuk,
	useSeferOpenPerush,
} from "./sefer-pasuk-navigation";
import { TanahpediaLink } from "./TanahpediaLink";
import { useSeferContentNavigation } from "./useSeferContentNavigation";
import "html-flip-book-react/styles.css";
import "./sefer.css";

/** Props we pass to FlipBook; matches html-flip-book-react FlipBookProps for typing dynamic() */
type FlipBookProps = {
	handlers?: { onPageFlipping?: () => void; onPageFlipped?: () => void };
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
	/** Remember the flipbook's mouse interaction mode. */
	mouseModeStorageKey?: string;
};

/**
 * Pasuk number in a book content page. While a perush is open on the facing
 * blank page and annotates this pasuk, activating the number jumps to that
 * pasuk's commentary group; otherwise it keeps its recitation behaviour.
 */
function SeferPasukNumber({
	perekId,
	pasuk,
}: {
	perekId: number;
	pasuk: number;
}) {
	const openPerush = useSeferOpenPerush(perekId);
	return (
		<RecitationPasukControl
			pasuk={pasuk}
			onNavigate={
				openPerush?.pesukim.has(pasuk)
					? () => scrollToPerushPasuk(perekId, pasuk)
					: undefined
			}
		>
			<span className={styles.pasukNum}>{toLetters(pasuk)}</span>
		</RecitationPasukControl>
	);
}

/** Dynamic FlipBook with ref forwarded (library uses forwardRef) */
const FlipBook = dynamic<
	FlipBookProps & { ref?: React.RefObject<FlipBookHandle | null> }
>(() => import("html-flip-book-react").then((mod) => mod.FlipBook), {
	ssr: false,
});

const Sefer = (props: {
	perekObj: PerekObj;
	sefer: SefarimItem;
	articles: ArticleSummary[];
	perushim: PerushSummary[];
	perekIds?: number[];
	entityRefsByPerek?: Record<number, PerekEntityReference[]>;
	imagesByPerek?: Record<number, PerekIllustration[]>;
	initialSlug?: string;
	initialBookPage?: BookPage | null;
	/** Whether the reader is shown. A host may keep it mounted but hidden (the
	 * perek overlay during close animation); while hidden the flat page title
	 * is restored. Defaults to true for hosts that always show the reader. */
	isVisible?: boolean;
}) => {
	const {
		perekObj,
		articles,
		perushim,
		perekIds,
		entityRefsByPerek,
		imagesByPerek,
		initialSlug,
		initialBookPage,
		isVisible = true,
	} = props;
	const sefer = props.sefer;
	const flipBookRef = useRef<FlipBookHandle>(null);
	const bookWrapperRef = useRef<HTMLDivElement>(null);
	const seferColor = getSeferColor(perekObj.sefer);
	const [isBookshelfOpen, setIsBookshelfOpen] = useState(false);
	const contentNavigation = useSeferContentNavigation(
		perekObj.perekId,
		initialSlug,
	);
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

	const perekHeaders = useMemo(() => perakim.map((p) => p.header), [perakim]);
	const hePageSemantics: PageSemantics = useMemo(
		() => buildPageSemantics(perakim.length, perekHeaders),
		[perakim.length, perekHeaders],
	);

	const historyMapper: HistoryMapper | undefined = useMemo(
		() => buildHistoryMapper(perekIds, hePageSemantics, perekObj.sefer),
		[perekIds, hePageSemantics, perekObj.sefer],
	);

	// Document-title sync (issue #2176): the library's onPageFlipped marks when
	// the active page/spread is committed (initial render, flips, TOC and
	// programmatic jumps, Back/Forward restores) — the resolver supplies what
	// the tab should say, agreeing with the history mapping for the same page.
	const seferPerekTitles = useMemo(() => buildSeferPerekTitles(sefer), [sefer]);
	const backCoverPageIndex = CONTENT_OFFSET + perakim.length * 2;
	const documentTitleResolver = useMemo(
		() =>
			buildSeferDocumentTitleResolver(
				perekObj.sefer,
				seferPerekTitles,
				backCoverPageIndex,
			),
		[perekObj.sefer, seferPerekTitles, backCoverPageIndex],
	);
	const [bookPageTitle, setBookPageTitle] = useState<string | null>(null);
	const [inBookContentTitle, setInBookContentTitle] = useState<string | null>(
		null,
	);

	// Single writer: while an article or perush is shown inside the book, its
	// title wins over the committed page's title, matching the standalone page.
	// While the reader is kept mounted but hidden, hand the title back to the
	// flat perek page; on unmount, release() restores it only if the reader
	// still owns it, so a stale book cannot clobber another page's title.
	const flatPageTitle = perekDocumentTitle(perekObj.source);
	// On a standalone article/perush route the reader closes back onto that
	// page — its own title, not the perek's, must be the release fallback.
	const pathname = usePathname();
	const standaloneTitle = useMemo(() => {
		const slug = /^\/929\/\d+\/([^/]+)$/.exec(pathname ?? "")?.[1];
		if (!slug) return null;
		const decoded = decodeURIComponent(slug);
		const article = articles.find((a) => String(a.id) === decoded);
		if (article) return articleDocumentTitle(article);
		const perush = perushim.find((p) => p.name === decoded);
		return perush
			? perushDocumentTitle(perush, {
					source: perekObj.source,
					seferName: sefer.name,
					perekHeb: perekObj.perekHeb,
				})
			: null;
	}, [pathname, articles, perushim, perekObj, sefer.name]);
	const releaseTitle = standaloneTitle ?? flatPageTitle;
	useEffect(() => {
		if (!isVisible) {
			releaseSeferDocumentTitle(releaseTitle);
			return;
		}
		const title = inBookContentTitle ?? bookPageTitle;
		if (title != null) setSeferDocumentTitle(title);
	}, [inBookContentTitle, bookPageTitle, isVisible, releaseTitle]);
	useEffect(
		() => () => releaseSeferDocumentTitle(releaseTitle),
		[releaseTitle],
	);

	const { onPageFlipped: onContentPageFlipped } = contentNavigation;
	const handlePageFlipped = useCallback(() => {
		onContentPageFlipped();
		// Fired once the new page is committed, just before the history write;
		// the settled index comes from the book so rapid turns cannot go stale.
		const pageIndex = flipBookRef.current?.getCurrentPageIndex();
		if (pageIndex == null) return;
		setBookPageTitle(documentTitleResolver(pageIndex));
	}, [onContentPageFlipped, documentTitleResolver]);

	const initialTurnedLeaves = useMemo(
		() =>
			initialBookPage === "front"
				? []
				: initialBookPage === "toc"
					? [0]
					: initialBookPage === "back"
						? Array.from({ length: perakim.length + 2 }, (_, i) => i)
						: computeInitialTurnedLeaves(perekIds, perekObj.perekId),
		[initialBookPage, perakim.length, perekIds, perekObj.perekId],
	);

	// Next can navigate to another book URL while retaining this Sefer instance.
	// The flipbook itself handles its own Back/Forward entries; for a router
	// navigation, move to the requested spread without pushing a duplicate entry.
	const requestedPage = historyMapper?.routeToPage(
		initialBookPage
			? bookPageRoute(perekObj.sefer, initialBookPage)
			: `/929/${perekObj.perekId}?book`,
	);
	useEffect(() => {
		const book = flipBookRef.current;
		if (
			book &&
			requestedPage != null &&
			requestedPage !== book.getCurrentPageIndex()
		) {
			book.restorePage(requestedPage);
		}
		// Fresh data references for the same route must not undo a user's flip.
	}, [requestedPage]);

	// While the reader is shown, mark the document so the scroll lock in
	// sefer.css confines scrolling to the book's inner panes (issue #2178).
	// The perek overlay keeps this component mounted after the book closes,
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

	const frontCover = (
		<section
			key="front-cover"
			className={`${styles.page} ${styles.cover}`}
			aria-label="עטיפה קדמית"
			style={{ "--cover-color": seferColor } as React.CSSProperties}
		>
			<div className={styles.coverInner}>
				<div className={styles.coverContent}>
					<div className={styles.coverOrnament}>✦</div>
					<h1 className={styles.coverTitle}>ספר {perekObj.sefer}</h1>
					<div className={styles.coverDivider} />
					<p className={styles.coverSubtitle}>מקראות גדולות</p>
					<p className={styles.coverEdition}>עם מאמרים מרבנים בני זמנינו</p>
				</div>
			</div>
		</section>
	);
	const backCover = (
		<section
			key="back-cover"
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
	const [batchSummaries, setBatchSummaries] = useState<
		Record<string, PerekSummaries>
	>({});
	useEffect(() => {
		const idsToFetch = perekIds?.filter((id) => id !== perekObj.perekId) ?? [];
		if (idsToFetch.length === 0) return;
		getPerekSummariesBatch(idsToFetch)
			.then(setBatchSummaries)
			.catch((error) => {
				console.error("Failed to load book summaries", {
					sefer: perekObj.sefer,
					perekIds: idsToFetch,
					error,
				});
			});
	}, [perekIds, perekObj.perekId, perekObj.sefer]);

	const contentPages = perakim.flatMap((perek, perekIdx) => {
		const pagePerekId = perekIds?.[perekIdx];
		// Prefer a stable perek id for keys; fall back to index only when the id
		// isn't available, so React state stays attached to the right page even
		// if the perakim order ever changes.
		const perekKeyBase = pagePerekId ?? `idx-${perekIdx + 1}`;
		const perekKey = `perek-${perekKeyBase}`;
		const blankKey = `blank-${perekKeyBase}`;
		const illustrations = imagesByPerek?.[perekIds?.[perekIdx] ?? -1] ?? [];
		return [
			<React.Fragment key={perekKey}>
				<RecitationPlayer
					perekId={pagePerekId ?? 0}
					pesukim={perek.pesukim}
					hasRecording={Boolean(perek.recitation)}
				>
					<section
						className={styles.pageContentPage}
						data-sefer-perek={pagePerekId}
					>
						<div className={styles.pageHeaderRight}>
							<div className={styles.pageHeaderRow}>
								<span className={styles.pageHeaderSefer}>{perekObj.sefer}</span>
								<span className={styles.pageHeaderPerek}>
									{toHebrewChapterNumber(perekIdx + 1)}
								</span>
							</div>
							<RecitationHeader title={perek.header} />
						</div>
						<div className={styles.perekTextScrollWrapper}>
							{illustrations.map((illustration) => (
								<figure
									key={illustration.id}
									className={styles.perekIllustrationFigure}
								>
									<picture>
										{illustration.avifSrcSet && (
											<source
												type="image/avif"
												srcSet={illustration.avifSrcSet}
												sizes="(max-width: 768px) 100vw, 420px"
											/>
										)}
										<Image
											src={illustration.src}
											alt={illustration.alt}
											width={illustration.width}
											height={illustration.height}
											sizes="(max-width: 768px) 100vw, 420px"
											loading="lazy"
											unoptimized
											className={styles.perekIllustration}
										/>
									</picture>
									<figcaption>
										<ImageCaption image={illustration} />
									</figcaption>
								</figure>
							))}
							<article className={styles.perekText}>
								{perek.pesukim.map((pasuk, pasukIdx) => {
									const pasukKey = pasukIdx + 1;
									const pasukNumElement = (
										<SeferPasukNumber
											perekId={pagePerekId ?? 0}
											pasuk={pasukKey}
										/>
									);
									const perekLookup =
										entityRefLookupsByPerekIdx[perekIdx] ??
										buildEntityRefLookup([]);
									const pasukElement = renderPasukWithEntityRefs(
										pasuk.segments,
										pasukIdx,
										perekLookup,
										Ptuah,
										Stuma,
										styles.qri,
										(entryUniqueName, children, key) => (
											<RecitationLink
												key={key}
												link={
													<TanahpediaLink
														key={key}
														entryUniqueName={entryUniqueName}
														className={styles.tanahpediaLink}
													>
														{children}
													</TanahpediaLink>
												}
											>
												{children}
											</RecitationLink>
										),
										(pasuk, segment, text) => (
											<RecitationWordControl pasuk={pasuk} segment={segment}>
												{text}
											</RecitationWordControl>
										),
									);
									return (
										<RecitationVerse key={pasukKey} pasuk={pasukKey}>
											{pasukNumElement}
											<span> </span>
											{pasukElement}
											<span> </span>
										</RecitationVerse>
									);
								})}
							</article>
						</div>
					</section>
				</RecitationPlayer>
			</React.Fragment>,
			<React.Fragment key={blankKey}>
				<BlankPageContent
					articles={
						perekIdx === currentPerekIdx
							? articles
							: batchSummaries[String(perekIds?.[perekIdx] ?? 0)]?.articles
					}
					perushim={
						perekIdx === currentPerekIdx
							? perushim
							: batchSummaries[String(perekIds?.[perekIdx] ?? 0)]?.perushim
					}
					perekId={perekIds?.[perekIdx] ?? 0}
					hebrewDateStr={hebrewDateStr}
					initialSlug={
						contentNavigation.content &&
						pagePerekId === contentNavigation.content.perekId
							? contentNavigation.content.slug
							: undefined
					}
					onNavigate={
						pagePerekId == null
							? undefined
							: (slug) => contentNavigation.navigate(pagePerekId, slug)
					}
					perekTitleParts={seferPerekTitles[perekIdx]}
					onContentTitle={setInBookContentTitle}
				/>
			</React.Fragment>,
		];
	});

	// Total pages: cover + cover-interior + TOC + (perakim * 2) + backCover
	const totalPages = 3 + perakim.length * 2 + 1;

	const tocPage = (
		<TocPage
			key="toc"
			onNavigate={(pageIndex) => flipBookRef.current?.jumpToPage(pageIndex)}
			totalPages={totalPages}
			pageSemantics={hePageSemantics}
			getHref={(entry) =>
				historyMapper?.pageToRoute(entry.pageIndex, {
					semanticName: entry.semanticName,
					title: entry.title,
				})
			}
			heading="תוכן העניינים"
			direction="rtl"
			filter={(entry) =>
				entry.pageIndex >= CONTENT_OFFSET && entry.title.length > 0
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
			<div className={styles.bookWrapper} dir="rtl" ref={bookWrapperRef}>
				<div className={styles.bookArea}>
					<FlipBook
						handlers={{
							onPageFlipping: stopRecitation,
							onPageFlipped: handlePageFlipped,
						}}
						ref={flipBookRef}
						className="he-book"
						mouseModeStorageKey="sefer-mouse-book-mode"
						pages={pages}
						pageSemantics={hePageSemantics}
						direction="rtl"
						leavesBuffer={7}
						of={toHebrewChapterNumber(perakim.length)}
						tocPageIndex={2}
						coverConfig={{
							hardCovers: true,
							noShadow: true,
							coverIndices: "auto",
						}}
						pageShadow
						historyMapper={historyMapper}
						initialTurnedLeaves={initialTurnedLeaves}
						downloadConfig={{
							entireBookFilename: perekObj.sefer,
							rangeFilename: perekObj.sefer,
							downloadContext: { seferName: perekObj.sefer },
							onDownloadSefer: async () =>
								wrapDownloadResult(
									await downloadSefer({
										seferName: perekObj.sefer,
										perekIds:
											perekIds && perekIds.length > 0
												? perekIds
												: [perekObj.perekId],
									}),
								),
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
						<MouseModeButton />
						<ActionButton onClick={openBookshelf} ariaLabel={'ספרי התנ"ך'}>
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
