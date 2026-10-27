"use client";

import { toLetters } from "gematry";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	buildMonth,
	type CalendarDay,
	compareMonths,
	getConfirmedCycleCount,
	getCycle,
	getCycleForDate,
	getCycleLabel,
	getCycleName,
	getCycleStartMonth,
	getDateLabel,
	getMonthLabel,
	getMonthName,
	getMonthOrder,
	getPerekRangeLabel,
	getPerekSource,
	getYearLabel,
	isMergedReviewPair,
	type MonthCell,
	type MonthRef,
	nextMonth,
	prevMonth,
} from "@/data/learning-schedule";
import { resolveCalendarArtifactRequest } from "@/lib/download/calendar-artifacts";
import { parseNumericalDateToHebcalDate } from "@/util/hebdates-util";
import {
	CalendarPdfDownload,
	type CalendarPdfRequest,
} from "./CalendarPdfDownload";
import styles from "./learning-calendar.module.css";

const WEEKDAY_NAMES = [
	{ short: "א", full: "ראשון" },
	{ short: "ב", full: "שני" },
	{ short: "ג", full: "שלישי" },
	{ short: "ד", full: "רביעי" },
	{ short: "ה", full: "חמישי" },
	{ short: "ו", full: "שישי" },
	{ short: "ש", full: "שבת" },
] as const;

const MONTH_QUERY_PARAM = "month";
const VIEW_QUERY_PARAM = "view";
const CYCLE_QUERY_PARAM = "cycle";

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
	/**
	 * Static calendar-PDF manifest URL in the assets bucket (#2622); absent in
	 * tests/stories, where the action falls back to the legacy API path.
	 */
	pdfManifestUrl?: string;
}

export function LearningCalendar({
	initialYear,
	initialMonth,
	todayDateNumber,
	pdfManifestUrl = "",
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

	// Keep the viewed month in sync with the URL (back/forward, shared links).
	useEffect(() => {
		if (monthParam && compareMonths(monthParam, viewed) !== 0) {
			setViewed(monthParam);
		}
	}, [monthParam, viewed]);

	const pushParams = useCallback(
		(updates: { month?: MonthRef; view?: ViewMode; cycle?: number }) => {
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

	const backToToday = useCallback(() => {
		const today = parseNumericalDateToHebcalDate(todayDateNumber);
		navigateMonth({ year: today.year, month: today.getUniformMonth() });
	}, [navigateMonth, todayDateNumber]);

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

	// The PDF request captures this label+URL at click time (#2621) — a
	// pending download always keeps the period it was started for.
	const pdfScopeLabel =
		viewMode === "cycle"
			? getCycleName(getCycle(resolvedCycle))
			: viewMode === "year"
				? `שנת ${getYearLabel(viewed.year)}`
				: getMonthLabel(viewed);
	const pdfRequest = useMemo<CalendarPdfRequest>(() => {
		const params = new URLSearchParams({
			month: formatMonthParam(viewed),
			view: viewMode,
			cycle: String(resolvedCycle),
		});
		// The shared resolver keeps the canonical artifact key and filename
		// identical to how the legacy route reads these params (#2622).
		const resolved = resolveCalendarArtifactRequest(params);
		return {
			apiUrl: `/api/calendar-pdf?${params.toString()}`,
			manifestUrl: pdfManifestUrl,
			artifactKey: resolved.ok
				? resolved.key
				: /* istanbul ignore next -- defensive: our own params always parse */ "",
			filename: resolved.ok
				? resolved.filename
				: /* istanbul ignore next -- defensive: our own params always parse */ "learning-calendar.pdf",
		};
	}, [viewed, viewMode, resolvedCycle, pdfManifestUrl]);

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

	const dayAriaLabel = (day: CalendarDay): string => {
		const dateLabel = getDateLabel(day.date);
		if (day.perekId === undefined) {
			return `${dateLabel} - לא משובץ`;
		}
		const perekLabel =
			day.status === "review" && day.reviewPerekIds?.length
				? getPerekRangeLabel(day.reviewPerekIds)
				: getPerekSource(day.perekId);
		return day.status === "review"
			? `${dateLabel} - חזרה: ${perekLabel}`
			: `${dateLabel} - ${perekLabel}`;
	};

	/** One accessible name covering both dates of a merged review block. */
	const mergedAriaLabel = (
		friday: CalendarDay,
		shabbat: CalendarDay,
	): string => {
		/* istanbul ignore next -- the merge gate requires defined ids */
		const ids = friday.reviewPerekIds ?? [];
		return `${getDateLabel(friday.date)} - ${getDateLabel(shabbat.date)} - חזרה: ${getPerekRangeLabel(ids)}`;
	};

	/** Saturday dates swallowed by Friday's merged block in `cells`. */
	const mergedSaturdays = useMemo(() => {
		const merged = new Set<number>();
		for (let i = 0; i + 1 < cells.length; i++) {
			const shabbat = cells[i + 1].day;
			if (isMergedReviewPair(cells[i].day, shabbat)) {
				merged.add(shabbat.dateNumber);
			}
		}
		return merged;
	}, [cells]);

	return (
		<main className={styles.page}>
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

			<div className={styles.controls}>
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
				<CalendarPdfDownload request={pdfRequest} scopeLabel={pdfScopeLabel} />
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
								{getCycleName(cycle)}
							</option>
						))}
					</select>
				</label>
				{/* Month/year views keep the contextual cycle's range beside the
				    picker; in מחזור מלא the h2 already carries the selected
				    cycle's full label, so repeating it here would duplicate —
				    and displayedCycle describes the viewed month, not the
				    chosen cycle (#2725). */}
				{displayedCycle && viewMode !== "cycle" && (
					<span className={styles.cycleRange}>
						{getCycleLabel(displayedCycle)}
					</span>
				)}
			</div>

			{viewMode === "year" && (
				<div className={styles.yearGrid}>
					{getMonthOrder(viewed.year).map((month, index) => (
						<MiniMonth
							key={month}
							title={getMonthName(viewed.year, month)}
							cells={yearMonths[index]}
							todayDateNumber={todayDateNumber}
							onOpen={openPerek}
							dayAriaLabel={dayAriaLabel}
							mergedDayAriaLabel={mergedAriaLabel}
						/>
					))}
				</div>
			)}

			{viewMode === "cycle" && (
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
							mergedDayAriaLabel={mergedAriaLabel}
							dimmed={(day) => day.cycle !== resolvedCycle}
						/>
					))}
				</div>
			)}

			{viewMode === "month" && (
				<>
					<div className={styles.weekdays}>
						{WEEKDAY_NAMES.map((name) => (
							<div key={name.full} className={styles.weekday}>
								<span aria-hidden="true">{name.short}</span>
								<span className={styles.srOnly}>{name.full}</span>
							</div>
						))}
					</div>

					<div className={styles.grid}>
						{cells.map((cell, index) => {
							if (cell.day === undefined) {
								return (
									<div
										key={`blank-${cell.blankColumn}`}
										className={styles.blankCell}
										aria-hidden="true"
									/>
								);
							}
							const day = cell.day;
							if (mergedSaturdays.has(day.dateNumber)) {
								return null;
							}
							const shabbat = cells[index + 1]?.day;
							const merged = isMergedReviewPair(day, shabbat)
								? shabbat
								: undefined;
							return (
								<CalendarCell
									key={day.dateNumber}
									day={day}
									mergedWith={merged}
									isToday={
										day.dateNumber === todayDateNumber ||
										merged?.dateNumber === todayDateNumber
									}
									onOpen={openPerek}
									ariaLabel={
										merged ? mergedAriaLabel(day, merged) : dayAriaLabel(day)
									}
								/>
							);
						})}
					</div>
				</>
			)}

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
		</main>
	);
}

function CalendarCell({
	day,
	mergedWith,
	isToday,
	onOpen,
	ariaLabel,
}: {
	day: CalendarDay;
	/** Saturday when this Friday cell spans the shared review block (#2365). */
	mergedWith?: CalendarDay;
	isToday: boolean;
	/** Called only for tappable cells, so the perek id is always present. */
	onOpen: (perekId: number) => void;
	ariaLabel: string;
}) {
	const classNames = [
		styles.cell,
		day.status === "review" ? styles.reviewCell : "",
		mergedWith ? styles.mergedReviewCell : "",
		day.status === "none" ? styles.noneCell : "",
		isToday ? styles.todayCell : "",
	]
		.filter(Boolean)
		.join(" ");

	// Merged block: each date sits centered over its own weekday column —
	// the column headers already mark ו/ש, so no day letters inside (#2365).
	const dayNumber = mergedWith ? (
		<span className={styles.dayNumber}>
			<span className={styles.mergedDate}>
				{toLetters(day.day, { addQuotes: true })}
			</span>
			<span className={styles.mergedDate}>
				{toLetters(mergedWith.day, { addQuotes: true })}
			</span>
			{isToday ? <span className={styles.srOnly}> (היום)</span> : null}
		</span>
	) : (
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
	const perekLabel =
		day.status === "review" && day.reviewPerekIds?.length
			? getPerekRangeLabel(day.reviewPerekIds)
			: getPerekSource(perekId);
	return (
		<button
			type="button"
			className={classNames}
			aria-label={ariaLabel}
			onClick={() => onOpen(perekId)}
		>
			{dayNumber}
			<span className={styles.perekRef}>{perekLabel}</span>
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
	mergedDayAriaLabel,
	dimmed,
}: {
	title: string;
	cells: MonthCell[];
	todayDateNumber: number;
	onOpen: (perekId: number) => void;
	dayAriaLabel: (day: CalendarDay) => string;
	/** Both dates in one name for a merged review block (#2365). */
	mergedDayAriaLabel: (friday: CalendarDay, shabbat: CalendarDay) => string;
	dimmed?: (day: CalendarDay) => boolean;
}) {
	return (
		<section className={styles.miniMonth}>
			<h3 className={styles.miniMonthTitle}>{title}</h3>
			<div className={styles.miniWeekdays} aria-hidden="true">
				{WEEKDAY_NAMES.map((name) => (
					<span key={name.full} className={styles.miniWeekday}>
						{name.short}
					</span>
				))}
			</div>
			<div className={styles.miniGrid}>
				{cells.map((cell, index) => {
					if (cell.day === undefined) {
						return (
							<span
								key={`blank-${cell.blankColumn}`}
								className={styles.miniCell}
								aria-hidden="true"
							/>
						);
					}
					const day = cell.day;
					if (index > 0 && isMergedReviewPair(cells[index - 1].day, day)) {
						return null;
					}
					const shabbat = cells[index + 1]?.day;
					const merged = isMergedReviewPair(day, shabbat) ? shabbat : undefined;
					return (
						<MiniCell
							key={day.dateNumber}
							day={day}
							mergedWith={merged}
							isToday={
								day.dateNumber === todayDateNumber ||
								merged?.dateNumber === todayDateNumber
							}
							dimmed={dimmed?.(day) === true && (!merged || dimmed(merged))}
							onOpen={onOpen}
							ariaLabel={
								merged ? mergedDayAriaLabel(day, merged) : dayAriaLabel(day)
							}
						/>
					);
				})}
			</div>
		</section>
	);
}

function MiniCell({
	day,
	mergedWith,
	isToday,
	dimmed,
	onOpen,
	ariaLabel,
}: {
	day: CalendarDay;
	/** Saturday when this Friday cell spans the shared review block (#2365). */
	mergedWith?: CalendarDay;
	isToday: boolean;
	dimmed: boolean;
	onOpen: (perekId: number) => void;
	ariaLabel: string;
}) {
	const classNames = [
		styles.miniCell,
		day.status === "review" ? styles.miniReviewCell : "",
		mergedWith ? styles.miniMergedCell : "",
		day.status === "none" ? styles.miniNoneCell : "",
		dimmed ? styles.miniDimmed : "",
		isToday ? styles.miniTodayCell : "",
	]
		.filter(Boolean)
		.join(" ");
	const content = mergedWith
		? `${toLetters(day.day, { addQuotes: true })} - ${toLetters(mergedWith.day, { addQuotes: true })}`
		: toLetters(day.day, { addQuotes: true });

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
