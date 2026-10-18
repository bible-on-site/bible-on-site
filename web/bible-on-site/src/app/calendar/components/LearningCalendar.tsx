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
	getCycleLabel,
	getCycleStartMonth,
	getDateLabel,
	getMonthLabel,
	getMonthName,
	getMonthOrder,
	getPerekSource,
	getYearLabel,
	type MonthRef,
	nextMonth,
	prevMonth,
} from "@/data/learning-schedule";
import { parseNumericalDateToHebcalDate } from "@/util/hebdates-util";
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

	const [viewed, setViewed] = useState<MonthRef>(
		() => monthParam ?? { year: initialYear, month: initialMonth },
	);

	// Keep the viewed month in sync with the URL (back/forward, shared links).
	useEffect(() => {
		if (monthParam && compareMonths(monthParam, viewed) !== 0) {
			setViewed(monthParam);
		}
	}, [monthParam, viewed]);

	const navigateMonth = useCallback(
		(target: MonthRef) => {
			setViewed(target);
			const params = new URLSearchParams(searchParams.toString());
			params.set(MONTH_QUERY_PARAM, formatMonthParam(target));
			router.replace(`?${params.toString()}`, { scroll: false });
		},
		[router, searchParams],
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
			navigateMonth(getCycleStartMonth(getCycle(cycleNumber)));
		},
		[navigateMonth],
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

	const dayAriaLabel = (day: CalendarDay): string => {
		const dateLabel = getDateLabel(day.date);
		if (day.perekId === undefined) {
			return `${dateLabel} - לא משובץ`;
		}
		const perekLabel = getPerekSource(day.perekId);
		const first = day.reviewPerekIds?.[0];
		const reviewLabel =
			day.status === "review" &&
			first !== undefined &&
			first !== day.perekId
				? `${getPerekSource(first)} - ${perekLabel}`
				: perekLabel;
		return day.status === "review"
			? `${dateLabel} - חזרה: ${reviewLabel}`
			: `${dateLabel} - ${perekLabel}`;
	};

	return (
		<main className={styles.page}>
			<h1 className={styles.title}>לוח לימוד יומי</h1>

			<div className={styles.controls}>
				<button
					type="button"
					className={styles.navButton}
					onClick={() => navigateMonth(prevMonth(viewed))}
					aria-label="חודש קודם"
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
					onClick={() => navigateMonth(nextMonth(viewed))}
					aria-label="חודש הבא"
				>
					›
				</button>
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
			</div>

			<h2 className={styles.monthTitle}>{getMonthLabel(viewed)}</h2>

			<div className={styles.cycleRow}>
				<label className={styles.pickerLabel}>
					<span className={styles.srOnly}>מחזור לימוד</span>
					<select
						className={styles.picker}
						value={displayedCycle?.number ?? ""}
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

			<div className={styles.weekdays}>
				{WEEKDAY_NAMES.map((name) => (
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
