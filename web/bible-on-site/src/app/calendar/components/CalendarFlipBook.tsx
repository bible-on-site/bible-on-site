import { FlipBook } from "html-flip-book-react";
import type { FlipBookHandle, PageSemantics } from "html-flip-book-react";
import {
	ActionButton,
	FirstPageButton,
	LastPageButton,
	NextButton,
	PageIndicator,
	PrevButton,
	Toolbar,
} from "html-flip-book-react/toolbar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalendarDay, MonthRef } from "@/data/learning-schedule";
import {
	CalendarPdfDownload,
	type CalendarPdfRequest,
} from "./CalendarPdfDownload";
import { FlipMonthSheet, FlipMonthSheetBack } from "./FlipMonthSheet";
import {
	buildFlipPageSemantics,
	clampMonthToFlipScope,
	flipBookPageCount,
	flipMonthAtPageIndex,
	flipPageIndexForMonth,
	initialTurnedLeavesForPage,
	type FlipMonthEntry,
} from "./flip-month-data";
import "html-flip-book-react/styles.css";
import "./calendar-flip-book.css";

/**
 * Vertical spiral "Sefer-style" calendar book (#2993): one readable month
 * sheet per visible face, bound at the top with the upstream flip engine's
 * vertical axis. The component is loaded lazily by LearningCalendar only
 * when the flipping presentation is selected, so overview visitors never
 * pay for the engine.
 *
 * Page layout mirrors a physical spiral calendar:
 *   0 front cover · 1 blank endpaper · 2 title page · 3… month pairs
 *   (readable sheet + card back) · penultimate blank endpaper · last back
 *   cover.
 * Every month owns a whole visible pair like the Sefer reader's perakim —
 * a leaf turn advances two page indices, so a single face per month would
 * strand every second month under the turned stack (#2993 review).
 * History is disabled (`enableHistory={false}`): the host owns the `?month=`
 * query contract through `onMonthChange`/`jumpRequest`, so no stale `#page`
 * hashes or duplicate history entries appear.
 */
export function CalendarFlipBook({
	months,
	scopeLabel,
	scopeDetail,
	initialMonth,
	todayDateNumber,
	onMonthChange,
	jumpRequest,
	onOpenPerek,
	dayAriaLabel,
	mergedDayAriaLabel,
	isDimmed,
	onToday,
	onShowOverview,
	pdfRequest,
	pdfScopeLabel,
	pdfUnavailableReason,
}: {
	/** Ordered month sheets of the displayed scope (year or full cycle). */
	months: FlipMonthEntry[];
	/** Short scope caption for the cover/title pages (e.g. "שנת ה'תשפ\"ו"). */
	scopeLabel: string;
	/** Optional longer scope caption (cycle date range) for the title page. */
	scopeDetail?: string;
	/** Month the book should open on; clamped into `months` when outside. */
	initialMonth: MonthRef;
	todayDateNumber: number;
	/** Reports the top visible month face after each committed turn. */
	onMonthChange: (month: MonthRef) => void;
	/** Imperative jump to a month (Today / scope navigation), nonce-keyed. */
	jumpRequest: { month: MonthRef; nonce: number } | null;
	onOpenPerek: (perekId: number) => void;
	dayAriaLabel: (day: CalendarDay) => string;
	/** Both dates in one name for a merged review block (#2365). */
	mergedDayAriaLabel: (friday: CalendarDay, shabbat: CalendarDay) => string;
	isDimmed?: (day: CalendarDay) => boolean;
	onToday: () => void;
	onShowOverview: () => void;
	pdfRequest: CalendarPdfRequest;
	pdfScopeLabel: string;
	pdfUnavailableReason?: string;
}) {
	const flipBookRef = useRef<FlipBookHandle>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const pagesCount = flipBookPageCount(months.length);

	// Computed once per mount: the engine only reads initialTurnedLeaves at
	// construction, and the parent remounts this component (React key) whenever
	// the displayed scope changes, so a stable lazy value is correct here.
	const [initialTurnedLeaves] = useState(() => {
		const clamped = clampMonthToFlipScope(months, initialMonth);
		const pageIndex = flipPageIndexForMonth(months, clamped);
		// clampMonthToFlipScope always returns a month inside `months`, so
		// pageIndex is never -1 here; Math.max only satisfies the type.
		return initialTurnedLeavesForPage(
			Math.max(0, pageIndex),
			pagesCount,
		);
	});

	const pageSemantics = useMemo<PageSemantics>(
		() => buildFlipPageSemantics(months, pagesCount),
		[months, pagesCount],
	);

	const pages = useMemo(() => {
		const monthPages = months.flatMap((entry) => [
			<FlipMonthSheet
				key={`sheet-${entry.ref.year}-${entry.ref.month}`}
				entry={entry}
				todayDateNumber={todayDateNumber}
				onOpen={onOpenPerek}
				dayAriaLabel={dayAriaLabel}
				mergedDayAriaLabel={mergedDayAriaLabel}
				isDimmed={isDimmed}
			/>,
			<FlipMonthSheetBack
				key={`back-${entry.ref.year}-${entry.ref.month}`}
				entry={entry}
			/>,
		]);
		return [
			<section
				key="cal-front-cover"
				className="cal-cover"
				aria-label="עטיפה קדמית"
			>
				<div className="cal-cover__body">
					<h2 className="cal-cover__title">לוח לימוד יומי</h2>
					<p className="cal-cover__scope">{scopeLabel}</p>
				</div>
			</section>,
			<div key="cal-cover-interior" className="cal-interior" />,
			<section key="cal-title-page" className="cal-title-page">
				<h2 className="cal-title-page__title">לוח לימוד יומי</h2>
				<p className="cal-title-page__scope">{scopeLabel}</p>
				{scopeDetail ? (
					<p className="cal-title-page__detail">{scopeDetail}</p>
				) : null}
				<p className="cal-title-page__hint">
					גררו את הקצה התחתון של הדף כלפי מעלה כדי להפוך עמוד
				</p>
				<ul className="cal-title-page__legend">
					<li>
						<span className="cal-legend__swatch cal-legend__study" />
						יום לימוד
					</li>
					<li>
						<span className="cal-legend__swatch cal-legend__review" />
						יום חזרה
					</li>
					<li>
						<span className="cal-legend__swatch cal-legend__none" />
						לא משובץ
					</li>
				</ul>
			</section>,
			...monthPages,
			<div key="cal-back-interior" className="cal-interior" />,
			<section
				key="cal-back-cover"
				className="cal-cover cal-cover--back"
				aria-label="עטיפה אחורית"
			/>,
		];
	}, [
		months,
		todayDateNumber,
		onOpenPerek,
		dayAriaLabel,
		mergedDayAriaLabel,
		isDimmed,
		scopeLabel,
		scopeDetail,
	]);

	/**
	 * Covered faces must not duplicate tab stops or screen-reader content.
	 * The engine only masks dormant (out-of-buffer) content; faces inside the
	 * active buffer stay painted under the turning leaf, so we mark every
	 * `.page` that is neither the visible spread nor mid-flip as inert +
	 * aria-hidden. `inert`/`aria-hidden` never affect painting, so the stack
	 * visuals are untouched and the state re-syncs on each committed turn.
	 */
	const syncPageExposure = useCallback(() => {
		const root = containerRef.current;
		/* istanbul ignore next -- defensive: the callback only fires after
		   mount, when the wrapper ref is already attached */
		if (!root) {
			return;
		}
		for (const page of root.querySelectorAll<HTMLElement>(".page")) {
			const exposed =
				page.classList.contains("current-page") ||
				page.classList.contains("page--flipping");
			if (exposed) {
				page.removeAttribute("inert");
				page.removeAttribute("aria-hidden");
			} else {
				page.setAttribute("inert", "");
				page.setAttribute("aria-hidden", "true");
			}
		}
	}, []);

	const handlePageFlipped = useCallback(() => {
		syncPageExposure();
		const book = flipBookRef.current;
		if (!book) {
			return;
		}
		// currentPageIndex is the top (earlier) face of the visible spread.
		const month = flipMonthAtPageIndex(months, book.getCurrentPageIndex());
		if (month) {
			onMonthChange(month);
		}
	}, [months, onMonthChange, syncPageExposure]);

	// Runs after every render so engine class/buffer updates that do not emit
	// a flip event (initial layout, jumps, buffer refreshes) stay consistent.
	useEffect(() => {
		syncPageExposure();
	});

	const lastJumpNonce = useRef(0);
	useEffect(() => {
		if (!jumpRequest || jumpRequest.nonce === lastJumpNonce.current) {
			return;
		}
		lastJumpNonce.current = jumpRequest.nonce;
		const book = flipBookRef.current;
		if (!book) {
			return;
		}
		const clamped = clampMonthToFlipScope(months, jumpRequest.month);
		const pageIndex = flipPageIndexForMonth(months, clamped);
		if (pageIndex >= 0) {
			book.jumpToPage(pageIndex);
			syncPageExposure();
		}
	}, [jumpRequest, months, syncPageExposure]);

	return (
		<div className="cal-book-wrap" ref={containerRef} dir="rtl">
			<div className="cal-book-area">
				<FlipBook
					ref={flipBookRef}
					className="cal-book"
					pages={pages}
					pageSemantics={pageSemantics}
					direction="rtl"
					flipAxis="vertical"
					// Portrait sheets like the upstream spiral-calendar demo:
					// a month grid needs height more than width.
					leafAspectRatio={{ width: 5, height: 7 }}
					coverAspectRatio={{ width: 5.4, height: 7.4 }}
					// Spiral coil strip height at the top binding (px), matching
					// the upstream vertical-calendar demo.
					bindingSize={72}
					leavesBuffer={4}
					coverConfig={{
						hardCovers: true,
						noShadow: true,
						coverIndices: "auto",
					}}
					pageShadow
					enableHistory={false}
					// The engine's DOM-snapshot download is not used; the toolbar
					// offers the site's own CalendarPdfDownload instead.
					enableDownload={false}
					initialTurnedLeaves={initialTurnedLeaves}
					of={months.length}
					handlers={{ onPageFlipped: handlePageFlipped }}
				/>
			</div>
			<Toolbar
				flipBookRef={flipBookRef}
				direction="rtl"
				pageSemantics={pageSemantics}
			>
				<div className="flipbook-toolbar-start">
					<ActionButton onClick={onToday} ariaLabel="חזור להיום">
						היום
					</ActionButton>
					<ActionButton
						onClick={onShowOverview}
						ariaLabel="מעבר לתצוגת הסקירה"
					>
						סקירה
					</ActionButton>
				</div>
				<div className="flipbook-toolbar-nav-cluster">
					<FirstPageButton />
					<PrevButton />
					<PageIndicator ariaLabel="עבור לחודש" />
					<NextButton />
					<LastPageButton />
				</div>
				<div className="flipbook-toolbar-end">
					<CalendarPdfDownload
						request={pdfRequest}
						scopeLabel={pdfScopeLabel}
						unavailableReason={pdfUnavailableReason}
					/>
				</div>
			</Toolbar>
		</div>
	);
}
