"use client";

import { toLetters } from "gematry";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	buildMonth,
	type CalendarDay,
	compareMonths,
	getConfirmedCycleCount,
	getCycle,
	getCycleForDate,
	getCycleLabel,
	getCycleStartMonth,
	getDateLabel,
	getMonthLabel,
	getMonthName,
	getMonthOrder,
	getPerekSource,
	getYearLabel,
	type MonthCell,
	type MonthRef,
	nextMonth,
	prevMonth,
} from "@/data/learning-schedule";
import {
	getStoredCalendarFlipView,
	setStoredCalendarFlipView,
} from "@/lib/calendar-flip-view";
import { parseNumericalDateToHebcalDate } from "@/util/hebdates-util";
import { CalendarPdfDownload } from "./CalendarPdfDownload";
import {
	buildCycleFlipMonths,
	buildYearFlipMonths,
	CALENDAR_WEEKDAYS,
	type FlipMonthEntry,
} from "./flip-month-data";
import styles from "./learning-calendar.module.css";

/**
 * The vertical spiral calendar book (#2993) is code-split: the flip engine
 * and month sheets only load after the flipping presentation is selected,
 * keeping the default overview path free of that weight.
 */
const CalendarFlipBook = dynamic(
	() => import("./CalendarFlipBook").then((mod) => mod.CalendarFlipBook),
	{ ssr: false },
);

const MONTH_QUERY_PARAM = "month";
const VIEW_QUERY_PARAM = "view";
const CYCLE_QUERY_PARAM = "cycle";
const FLIP_QUERY_PARAM = "flip";

const VIEW_MODES = [
	{ key: "month", label: "חודשי" },
	{ key: "year", label: "שנתי" },
	{ key: "cycle", label: "מחזור מלא" },
] as const;

type ViewMode = (typeof VIEW_MODES)[number]["key"];

function parseViewParam(raw: string | null): ViewMode {
	return VIEW_MODES.some((mode) => mode.key === raw)
		? (raw as ViewMode)
		: "month";
}

function parseCycleParam(raw: string | null): number | null {
	if (raw === null || !/^\d+$/.test(raw)) {
		return null;
	}
	const cycle = Number.parseInt(raw, 10);
	return cycle >= 1 ? cycle : null;
}

/**
 * Parses the `?month=YYYYMM` query value into a MonthRef.
 * Returns null for malformed values or a month that cannot exist
 * (e.g. uniform month 13/14 in a non-leap year).
 */
function parseMonthParam(raw: string | null): MonthRef | null {
	if (raw === null || !/^\d{6}$/.test(raw)) {
		return null;
	}
	const year = Number.parseInt(raw.slice(0, 4), 10);
	const month = Number.parseInt(raw.slice(4), 10);
	return getMonthOrder(year).includes(month) ? { year, month } : null;
}

function formatMonthParam({ year, month }: MonthRef): string {
	return `${year}${month.toString().padStart(2, "0")}`;
}

interface LearningCalendarProps {
	/** Hebrew year of the month to show when no ?month= param is present. */
	initialYear: number;
	/** Uniform Hebrew month (1-14) of the month to show initially. */
	initialMonth: number;
	/** Today marker as YYYYMMDD (uniform month), Jerusalem/nightfall aware. */
	todayDateNumber: number;
}

export function LearningCalendar({
	initialYear,
	initialMonth,
	todayDateNumber,
}: LearningCalendarProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const monthParam = parseMonthParam(searchParams.get(MONTH_QUERY_PARAM));
	const viewParam = parseViewParam(searchParams.get(VIEW_QUERY_PARAM));
	const cycleParam = parseCycleParam(searchParams.get(CYCLE_QUERY_PARAM));

	const [viewed, setViewed] = useState<MonthRef>(
		() => monthParam ?? { year: initialYear, month: initialMonth },
	);
	const [viewMode, setViewMode] = useState<ViewMode>(viewParam);
	const [viewedCycle, setViewedCycle] = useState<number | null>(cycleParam);

	// Flipping presentation (#2993): an explicit ?flip=1 wins (shareable
	// deep link); otherwise the persisted reader preference applies once
	// mounted. Only meaningful for the year/cycle scopes.
	const flipParam = searchParams.get(FLIP_QUERY_PARAM) === "1";
	const [prefFlip, setPrefFlip] = useState<boolean | null>(null);
	useEffect(() => {
		setPrefFlip(getStoredCalendarFlipView() === "flip");
	}, []);
	const flipPresentation =
		viewMode !== "month" && (flipParam || prefFlip === true);

	// Keep the viewed month in sync with the URL (back/forward, shared links).
	// While flipping, the book owns the viewed month and reports it back via
	// ?month= — syncing from the param here would race the async router
	// replace and flicker the position, so the book is the single writer.
	useEffect(() => {
		if (flipPresentation) {
			return;
		}
		if (monthParam && compareMonths(monthParam, viewed) !== 0) {
			setViewed(monthParam);
		}
	}, [monthParam, viewed, flipPresentation]);

	const pushParams = useCallback(
		(updates: {
			month?: MonthRef;
			view?: ViewMode;
			cycle?: number;
			flip?: "on" | "off";
		}) => {
			const params = new URLSearchParams(searchParams.toString());
			if (updates.month) {
				params.set(MONTH_QUERY_PARAM, formatMonthParam(updates.month));
			}
			if (updates.view) {
				params.set(VIEW_QUERY_PARAM, updates.view);
			}
			if (updates.cycle !== undefined) {
				params.set(CYCLE_QUERY_PARAM, String(updates.cycle));
			}
			if (updates.flip === "on") {
				params.set(FLIP_QUERY_PARAM, "1");
			} else if (updates.flip === "off") {
				params.delete(FLIP_QUERY_PARAM);
			}
			router.replace(`?${params.toString()}`, { scroll: false });
		},
		[router, searchParams],
	);

	const navigateMonth = useCallback(
		(target: MonthRef) => {
			setViewed(target);
			pushParams({ month: target });
		},
		[pushParams],
	);

	const selectView = useCallback(
		(mode: ViewMode) => {
			setViewMode(mode);
			pushParams({ view: mode });
		},
		[pushParams],
	);

	const selectCycle = useCallback(
		(cycleNumber: number) => {
			setViewedCycle(cycleNumber);
			pushParams({ cycle: cycleNumber });
		},
		[pushParams],
	);

	const selectPresentation = useCallback(
		(flip: boolean) => {
			setStoredCalendarFlipView(flip ? "flip" : "overview");
			setPrefFlip(flip);
			// ?flip=1 stays in shareable URLs; overview drops the param and
			// relies on the persisted preference instead.
			pushParams({ flip: flip ? "on" : "off" });
		},
		[pushParams],
	);

	const overviewToggleRef = useRef<HTMLButtonElement>(null);
	const handleShowOverview = useCallback(() => {
		selectPresentation(false);
		// The toolbar button unmounts together with the book; return focus
		// to the persistent presentation toggle so keyboard users keep place.
		requestAnimationFrame(() => overviewToggleRef.current?.focus());
	}, [selectPresentation]);

	const cells = useMemo(() => buildMonth(viewed.year, viewed.month), [viewed]);

	// The cycle owning most of the visible month: the cycle of the first
	// scheduled day, else of the last scheduled day (inter-cycle gap months).
	const displayedCycle = useMemo(() => {
		const days = cells.flatMap((cell) => (cell.day ? [cell.day] : []));
		const anchor =
			days.find((day) => day.cycle !== undefined) ??
			[...days].reverse().find((day) => day.cycle !== undefined);
		return anchor?.cycle !== undefined ? getCycle(anchor.cycle) : null;
	}, [cells]);

	const cycleOptions = useMemo(() => {
		const confirmedCount = getConfirmedCycleCount();
		const max =
			displayedCycle && displayedCycle.number > confirmedCount
				? displayedCycle.number
				: confirmedCount;
		return Array.from({ length: max }, (_, i) => getCycle(i + 1));
	}, [displayedCycle]);

	const yearOptions = useMemo(() => {
		const confirmedCount = getConfirmedCycleCount();
		const years = new Set<number>();
		const lastConfirmed = getCycle(confirmedCount);
		for (
			let year = getCycle(1).start.year;
			year <= lastConfirmed.end.year;
			year += 1
		) {
			years.add(year);
		}
		years.add(viewed.year);
		return [...years].sort((a, b) => a - b);
	}, [viewed.year]);

	const onCycleSelected = useCallback(
		(cycleNumber: number) => {
			if (viewMode === "cycle") {
				selectCycle(cycleNumber);
			} else {
				navigateMonth(getCycleStartMonth(getCycle(cycleNumber)));
			}
		},
		[navigateMonth, selectCycle, viewMode],
	);

	const onYearSelected = useCallback(
		(year: number) => {
			// When the viewed month does not exist in the target year
			// (Adar I/II of a leap year), fall back to plain Adar.
			const month = getMonthOrder(year).includes(viewed.month)
				? viewed.month
				: 6;
			navigateMonth({ year, month });
		},
		[navigateMonth, viewed.month],
	);

	const openPerek = useCallback(
		(perekId: number) => {
			router.push(`/929/${perekId}`);
		},
		[router],
	);

	// The cycle owning most scheduled days in the viewed month; falls back to
	// today's cycle when the month lies in an inter-cycle gap.
	const contextualCycle = useMemo(() => {
		const counts = new Map<number, number>();
		for (const cell of cells) {
			if (cell.day?.cycle !== undefined) {
				counts.set(cell.day.cycle, (counts.get(cell.day.cycle) ?? 0) + 1);
			}
		}
		let best: number | undefined;
		let bestCount = 0;
		for (const [cycle, count] of counts) {
			if (count > bestCount) {
				best = cycle;
				bestCount = count;
			}
		}
		return (
			best ??
			getCycleForDate(parseNumericalDateToHebcalDate(todayDateNumber))
				?.number ??
			1
		);
	}, [cells, todayDateNumber]);

	const resolvedCycle = viewedCycle ?? contextualCycle;

	// Ordered month sheets for the flipping book (#2993); empty while the
	// overview is shown so no schedule work is wasted on it.
	const flipMonths = useMemo<FlipMonthEntry[]>(() => {
		if (!flipPresentation) {
			return [];
		}
		return viewMode === "year"
			? buildYearFlipMonths(viewed.year)
			: buildCycleFlipMonths(resolvedCycle);
	}, [flipPresentation, viewMode, viewed.year, resolvedCycle]);

	// While flipping a full cycle without an explicit ?cycle=, pin the
	// resolved cycle into the URL and state: each flipped month would
	// otherwise re-resolve the contextual cycle at boundaries and remount
	// the book mid-browse.
	useEffect(() => {
		if (
			flipPresentation &&
			viewMode === "cycle" &&
			cycleParam === null &&
			viewedCycle === null
		) {
			setViewedCycle(resolvedCycle);
			pushParams({ cycle: resolvedCycle });
		}
	}, [
		flipPresentation,
		viewMode,
		cycleParam,
		viewedCycle,
		resolvedCycle,
		pushParams,
	]);

	const flipJumpNonce = useRef(0);
	const [flipJump, setFlipJump] = useState<{
		month: MonthRef;
		nonce: number;
	} | null>(null);
	const requestFlipJump = useCallback((month: MonthRef) => {
		flipJumpNonce.current += 1;
		setFlipJump({ month, nonce: flipJumpNonce.current });
	}, []);

	const handleFlipMonthChange = useCallback(
		(month: MonthRef) => {
			setViewed(month);
			pushParams({ month });
		},
		[pushParams],
	);

	const backToToday = useCallback(() => {
		const today = parseNumericalDateToHebcalDate(todayDateNumber);
		const target: MonthRef = {
			year: today.year,
			month: today.getUniformMonth(),
		};
		if (flipPresentation && viewMode === "cycle") {
			const inScope = flipMonths.some(
				(entry) => compareMonths(entry.ref, target) === 0,
			);
			if (!inScope) {
				// Today lies outside the displayed cycle: follow it into
				// today's own cycle so היום always lands on today.
				const todayCycle = getCycleForDate(today)?.number;
				if (todayCycle !== undefined && todayCycle !== resolvedCycle) {
					setViewedCycle(todayCycle);
					setViewed(target);
					pushParams({ month: target, cycle: todayCycle });
					requestFlipJump(target);
					return;
				}
			}
		}
		navigateMonth(target);
		if (flipPresentation) {
			requestFlipJump(target);
		}
	}, [
		flipPresentation,
		viewMode,
		flipMonths,
		resolvedCycle,
		pushParams,
		navigateMonth,
		requestFlipJump,
		todayDateNumber,
	]);

	// The PDF request captures this label+URL at click time (#2621) — a
	// pending download always keeps the period it was started for.
	const pdfScopeLabel =
		viewMode === "cycle"
			? `מחזור ${resolvedCycle}`
			: viewMode === "year"
				? `שנת ${getYearLabel(viewed.year)}`
				: getMonthLabel(viewed);
	const pdfUrl = `/api/calendar-pdf?month=${formatMonthParam(viewed)}&view=${viewMode}&cycle=${resolvedCycle}`;

	const yearMonths = useMemo(
		() =>
			viewMode === "year"
				? getMonthOrder(viewed.year).map((month) =>
						buildMonth(viewed.year, month),
					)
				: [],
		[viewMode, viewed.year],
	);

	const cycleMonths = useMemo(() => {
		if (viewMode !== "cycle") {
			return [] as MonthCell[][];
		}
		const cycle = getCycle(resolvedCycle);
		const months: MonthCell[][] = [];
		let ref: MonthRef = getCycleStartMonth(cycle);
		const endRef: MonthRef = {
			year: cycle.end.year,
			month: cycle.end.getUniformMonth(),
		};
		for (
			let guard = 0;
			guard < 50 && compareMonths(ref, endRef) <= 0;
			guard += 1
		) {
			months.push(buildMonth(ref.year, ref.month));
			ref = nextMonth(ref);
		}
		return months;
	}, [viewMode, resolvedCycle]);

	const dayAriaLabel = useCallback((day: CalendarDay): string => {
		const dateLabel = getDateLabel(day.date);
		if (day.perekId === undefined) {
			return `${dateLabel} - לא משובץ`;
		}
		const perekLabel = getPerekSource(day.perekId);
		const first = day.reviewPerekIds?.[0];
		const reviewLabel =
			day.status === "review" && first !== undefined && first !== day.perekId
				? `${getPerekSource(first)} - ${perekLabel}`
				: perekLabel;
		return day.status === "review"
			? `${dateLabel} - חזרה: ${reviewLabel}`
			: `${dateLabel} - ${perekLabel}`;
	}, []);

	// Out-of-cycle days in a full-cycle book render dimmed and inert —
	// identical rule to the overview's MiniMonth.
	const flipDayDimmed = useCallback(
		(day: CalendarDay) => day.cycle !== resolvedCycle,
		[resolvedCycle],
	);

	return (
		<main className={`${styles.page} ${flipPresentation ? styles.pageFlip : ""}`}>
			<h1 className={styles.title}>לוח לימוד יומי</h1>

			<div className={styles.viewToggle}>
				{VIEW_MODES.map((mode) => (
					<button
						key={mode.key}
						type="button"
						className={`${styles.viewButton} ${
							viewMode === mode.key ? styles.viewButtonActive : ""
						}`}
						aria-pressed={viewMode === mode.key}
						onClick={() => selectView(mode.key)}
					>
						{mode.label}
					</button>
				))}
			</div>

			{viewMode !== "month" && (
				<div className={styles.viewToggle}>
					<button
						ref={overviewToggleRef}
						type="button"
						className={`${styles.viewButton} ${
							!flipPresentation ? styles.viewButtonActive : ""
						}`}
						aria-pressed={!flipPresentation}
						onClick={() => selectPresentation(false)}
					>
						סקירה
					</button>
					<button
						type="button"
						className={`${styles.viewButton} ${
							flipPresentation ? styles.viewButtonActive : ""
						}`}
						aria-pressed={flipPresentation}
						onClick={() => selectPresentation(true)}
					>
						דפדוף
					</button>
				</div>
			)}

			<div className={styles.controls}>
				{!flipPresentation && (
					<>
						<button
							type="button"
							className={styles.navButton}
							onClick={() =>
								viewMode === "cycle"
									? selectCycle(resolvedCycle - 1)
									: viewMode === "year"
										? onYearSelected(viewed.year - 1)
										: navigateMonth(prevMonth(viewed))
							}
							aria-label={
								viewMode === "cycle"
									? "מחזור קודם"
									: viewMode === "year"
										? "שנה קודמת"
										: "חודש קודם"
							}
							disabled={viewMode === "cycle" && resolvedCycle <= 1}
						>
							‹
						</button>
						<button
							type="button"
							className={styles.todayButton}
							onClick={backToToday}
						>
							היום
						</button>
						<button
							type="button"
							className={styles.navButton}
							onClick={() =>
								viewMode === "cycle"
									? selectCycle(resolvedCycle + 1)
									: viewMode === "year"
										? onYearSelected(viewed.year + 1)
										: navigateMonth(nextMonth(viewed))
							}
							aria-label={
								viewMode === "cycle"
									? "מחזור הבא"
									: viewMode === "year"
										? "שנה הבאה"
										: "חודש הבא"
							}
						>
							›
						</button>
					</>
				)}
				{viewMode === "month" && (
					<label className={styles.pickerLabel}>
						<span className={styles.srOnly}>חודש</span>
						<select
							className={styles.picker}
							value={viewed.month}
							onChange={(event) =>
								navigateMonth({
									year: viewed.year,
									month: Number.parseInt(event.target.value, 10),
								})
							}
						>
							{getMonthOrder(viewed.year).map((month) => (
								<option key={month} value={month}>
									{getMonthName(viewed.year, month)}
								</option>
							))}
						</select>
					</label>
				)}
				{viewMode !== "cycle" && (
					<label className={styles.pickerLabel}>
						<span className={styles.srOnly}>שנה</span>
						<select
							className={styles.picker}
							value={viewed.year}
							onChange={(event) =>
								onYearSelected(Number.parseInt(event.target.value, 10))
							}
						>
							{yearOptions.map((year) => (
								<option key={year} value={year}>
									{getYearLabel(year)}
								</option>
							))}
						</select>
					</label>
				)}
				{!flipPresentation && (
					<CalendarPdfDownload url={pdfUrl} scopeLabel={pdfScopeLabel} />
				)}
			</div>

			<h2 className={styles.monthTitle}>
				{viewMode === "month" && getMonthLabel(viewed)}
				{viewMode === "year" && `שנת ${getYearLabel(viewed.year)}`}
				{viewMode === "cycle" && getCycleLabel(getCycle(resolvedCycle))}
			</h2>

			<div className={styles.cycleRow}>
				<label className={styles.pickerLabel}>
					<span className={styles.srOnly}>מחזור לימוד</span>
					<select
						className={styles.picker}
						value={
							viewMode === "cycle"
								? resolvedCycle
								: (displayedCycle?.number ?? "")
						}
						onChange={(event) =>
							onCycleSelected(Number.parseInt(event.target.value, 10))
						}
						aria-label="בחירת מחזור לימוד"
					>
						{displayedCycle === null && <option value="">-</option>}
						{cycleOptions.map((cycle) => (
							<option key={cycle.number} value={cycle.number}>
								מחזור {cycle.number}
								{cycle.projected ? " (משוער)" : ""}
							</option>
						))}
					</select>
				</label>
				{displayedCycle && (
					<span className={styles.cycleRange}>
						{getCycleLabel(displayedCycle)}
					</span>
				)}
			</div>

			{flipPresentation && flipMonths.length > 0 && (
				<CalendarFlipBook
					// Remount whenever the displayed scope changes so the book
					// re-anchors on the requested month instead of an index.
					key={
						viewMode === "year"
							? `year-${viewed.year}`
							: `cycle-${resolvedCycle}`
					}
					months={flipMonths}
					scopeLabel={pdfScopeLabel}
					scopeDetail={
						viewMode === "cycle"
							? getCycleLabel(getCycle(resolvedCycle))
							: undefined
					}
					initialMonth={viewed}
					todayDateNumber={todayDateNumber}
					onMonthChange={handleFlipMonthChange}
					jumpRequest={flipJump}
					onOpenPerek={openPerek}
					dayAriaLabel={dayAriaLabel}
					isDimmed={viewMode === "cycle" ? flipDayDimmed : undefined}
					onToday={backToToday}
					onShowOverview={handleShowOverview}
					pdfUrl={pdfUrl}
					pdfScopeLabel={pdfScopeLabel}
				/>
			)}

			{viewMode === "year" && !flipPresentation && (
				<div className={styles.yearGrid}>
					{getMonthOrder(viewed.year).map((month, index) => (
						<MiniMonth
							key={month}
							title={getMonthName(viewed.year, month)}
							cells={yearMonths[index]}
							todayDateNumber={todayDateNumber}
							onOpen={openPerek}
							dayAriaLabel={dayAriaLabel}
						/>
					))}
				</div>
			)}

			{viewMode === "cycle" && !flipPresentation && (
				<div className={styles.yearGrid}>
					{cycleMonths.map((cellsForMonth) => (
						<MiniMonth
							key={
								cellsForMonth.find((cell) => cell.day !== undefined)?.day
									?.dateNumber
							}
							title={getMonthLabelForCells(cellsForMonth)}
							cells={cellsForMonth}
							todayDateNumber={todayDateNumber}
							onOpen={openPerek}
							dayAriaLabel={dayAriaLabel}
							dimmed={(day) => day.cycle !== resolvedCycle}
						/>
					))}
				</div>
			)}

			{viewMode === "month" && (
				<>
					<div className={styles.weekdays}>
						{CALENDAR_WEEKDAYS.map((name) => (
							<div key={name.full} className={styles.weekday}>
								<span aria-hidden="true">{name.short}</span>
								<span className={styles.srOnly}>{name.full}</span>
							</div>
						))}
					</div>

					<div className={styles.grid}>
						{cells.map((cell) =>
							cell.day === undefined ? (
								<div
									key={`blank-${cell.blankColumn}`}
									className={styles.blankCell}
									aria-hidden="true"
								/>
							) : (
								<CalendarCell
									key={cell.day.dateNumber}
									day={cell.day}
									isToday={cell.day.dateNumber === todayDateNumber}
									onOpen={openPerek}
									ariaLabel={dayAriaLabel(cell.day)}
								/>
							),
						)}
					</div>
				</>
			)}

			{/* In flip mode the book's title page carries the legend, and the
			    saved vertical space keeps the bottom turn zone in view. */}
			{!flipPresentation && (
				<ul className={styles.legend} aria-label="מקרא">
					<li>
						<span
							className={`${styles.legendSwatch} ${styles.studySwatch}`}
							aria-hidden="true"
						/>
						יום לימוד
					</li>
					<li>
						<span
							className={`${styles.legendSwatch} ${styles.reviewSwatch}`}
							aria-hidden="true"
						/>
						יום חזרה
					</li>
					<li>
						<span
							className={`${styles.legendSwatch} ${styles.noneSwatch}`}
							aria-hidden="true"
						/>
						לא משובץ
					</li>
				</ul>
			)}
		</main>
	);
}

function CalendarCell({
	day,
	isToday,
	onOpen,
	ariaLabel,
}: {
	day: CalendarDay;
	isToday: boolean;
	/** Called only for tappable cells, so the perek id is always present. */
	onOpen: (perekId: number) => void;
	ariaLabel: string;
}) {
	const classNames = [
		styles.cell,
		day.status === "review" ? styles.reviewCell : "",
		day.status === "none" ? styles.noneCell : "",
		isToday ? styles.todayCell : "",
	]
		.filter(Boolean)
		.join(" ");

	const dayNumber = (
		<span className={styles.dayNumber}>
			{toLetters(day.day, { addQuotes: true })}
			{isToday ? <span className={styles.srOnly}> (היום)</span> : null}
		</span>
	);

	if (day.status === "none" || day.perekId === undefined) {
		return (
			<div className={classNames}>
				{dayNumber}
				<span className={styles.srOnly}>{ariaLabel}</span>
			</div>
		);
	}

	const perekId = day.perekId;
	return (
		<button
			type="button"
			className={classNames}
			aria-label={ariaLabel}
			onClick={() => onOpen(perekId)}
		>
			{dayNumber}
			<span className={styles.perekRef}>{getPerekSource(perekId)}</span>
			{day.status === "review" && (
				<span className={styles.reviewBadge}>חזרה</span>
			)}
		</button>
	);
}

function getMonthLabelForCells(cells: MonthCell[]): string {
	const day = cells.find((cell) => cell.day !== undefined)?.day;
	return day === undefined
		? ""
		: getMonthLabel({ year: day.date.year, month: day.date.getUniformMonth() });
}

function MiniMonth({
	title,
	cells,
	todayDateNumber,
	onOpen,
	dayAriaLabel,
	dimmed,
}: {
	title: string;
	cells: MonthCell[];
	todayDateNumber: number;
	onOpen: (perekId: number) => void;
	dayAriaLabel: (day: CalendarDay) => string;
	dimmed?: (day: CalendarDay) => boolean;
}) {
	return (
		<section className={styles.miniMonth}>
			<h3 className={styles.miniMonthTitle}>{title}</h3>
			<div className={styles.miniWeekdays} aria-hidden="true">
				{CALENDAR_WEEKDAYS.map((name) => (
					<span key={name.full} className={styles.miniWeekday}>
						{name.short}
					</span>
				))}
			</div>
			<div className={styles.miniGrid}>
				{cells.map((cell) =>
					cell.day === undefined ? (
						<span
							key={`blank-${cell.blankColumn}`}
							className={styles.miniCell}
							aria-hidden="true"
						/>
					) : (
						<MiniCell
							key={cell.day.dateNumber}
							day={cell.day}
							isToday={cell.day.dateNumber === todayDateNumber}
							dimmed={dimmed?.(cell.day) === true}
							onOpen={onOpen}
							ariaLabel={dayAriaLabel(cell.day)}
						/>
					),
				)}
			</div>
		</section>
	);
}

function MiniCell({
	day,
	isToday,
	dimmed,
	onOpen,
	ariaLabel,
}: {
	day: CalendarDay;
	isToday: boolean;
	dimmed: boolean;
	onOpen: (perekId: number) => void;
	ariaLabel: string;
}) {
	const classNames = [
		styles.miniCell,
		day.status === "review" ? styles.miniReviewCell : "",
		day.status === "none" ? styles.miniNoneCell : "",
		dimmed ? styles.miniDimmed : "",
		isToday ? styles.miniTodayCell : "",
	]
		.filter(Boolean)
		.join(" ");
	const content = toLetters(day.day, { addQuotes: true });

	if (day.perekId === undefined || dimmed) {
		return (
			<span className={classNames}>
				{content}
				<span className={styles.srOnly}>{ariaLabel}</span>
			</span>
		);
	}
	const perekId = day.perekId;
	return (
		<button
			type="button"
			className={classNames}
			aria-label={ariaLabel}
			onClick={() => onOpen(perekId)}
		>
			{content}
		</button>
	);
}
