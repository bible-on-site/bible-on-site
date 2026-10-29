import {
	HebrewDate,
	isHebrewLeapYear,
	uniformMonthToTemporalMonthCode,
} from "@/util/hebdates-util";
import {
	buildMonth,
	compareMonths,
	getCycle,
	getCycleForDate,
	getMonthOrder,
	type MonthRef,
	nextMonth,
	type StudyCycle,
} from "./learning-schedule";

export const CALENDAR_PDF_UNAVAILABLE =
	"ייצוא PDF זמין למחזור הנוכחי ולמחזור הבא החל משנה לפני תחילתו";

export function getCalendarCycleWindow(today: HebrewDate) {
	const first = getCycle(1);
	const current = getCycleForDate(today);
	let next = getCycle(current ? current.number + 1 : 1);
	// Between cycles (or before the programme), the first uncompleted cycle is next.
	while (!current && today.deltaDays(next.end) > 0) {
		next = getCycle(next.number + 1);
	}
	return {
		current,
		next,
		first,
		minMonth: { year: first.start.year, month: 1 },
		maxMonth: { year: next.end.year, month: next.end.getUniformMonth() },
	};
}

export type CalendarCycleWindow = ReturnType<typeof getCalendarCycleWindow>;

/** Same Hebrew month/day in the previous year, constraining missing Adar I. */
export function calendarCycleExportOpens(cycle: StudyCycle): HebrewDate {
	const year = cycle.start.year - 1;
	const monthCode =
		cycle.start.monthCode === "M05L" && !isHebrewLeapYear(year)
			? "M06"
			: cycle.start.monthCode;
	return HebrewDate.fromHebrewComponents(year, monthCode, cycle.start.day);
}

export function clampCalendarMonth(
	ref: MonthRef,
	window: CalendarCycleWindow,
): MonthRef {
	if (compareMonths(ref, window.minMonth) < 0) return window.minMonth;
	if (compareMonths(ref, window.maxMonth) > 0) return window.maxMonth;
	return ref;
}

export function visibleCalendarMonths(
	year: number,
	window: CalendarCycleWindow,
): number[] {
	return getMonthOrder(year).filter((month) => {
		const ref = { year, month };
		return (
			compareMonths(ref, window.minMonth) >= 0 &&
			compareMonths(ref, window.maxMonth) <= 0
		);
	});
}

/** Boundary months retain their dates without exposing a later cycle's study. */
export function buildVisibleCalendarMonth(
	year: number,
	month: number,
	window: CalendarCycleWindow,
) {
	return buildMonth(year, month).map((cell) => {
		const day = cell.day;
		if (
			!day ||
			(day.date.deltaDays(window.first.start) >= 0 &&
				day.date.deltaDays(window.next.end) <= 0)
		)
			return cell;
		return {
			day: {
				...day,
				status: "none" as const,
				perekId: undefined,
				reviewPerekIds: undefined,
				cycle: undefined,
				projected: undefined,
			},
		};
	});
}

export type CalendarExportPeriod =
	| { view: "cycle"; cycle: number }
	| { view: "year"; year: number }
	| { view: "month"; year: number; month: number };

export function canExportCalendarPeriod(
	period: CalendarExportPeriod,
	today: HebrewDate,
): boolean {
	const window = getCalendarCycleWindow(today);
	const eligible = [
		window.current,
		today.deltaDays(calendarCycleExportOpens(window.next)) >= 0
			? window.next
			: null,
	].filter((cycle): cycle is StudyCycle => cycle !== null);
	if (period.view === "cycle")
		return eligible.some((cycle) => cycle.number === period.cycle);
	if (
		eligible.length === 0 ||
		period.year < window.minMonth.year ||
		period.year > window.maxMonth.year
	)
		return false;
	const order = getMonthOrder(period.year);
	if (period.view === "month" && !order.includes(period.month)) return false;
	const firstMonth = period.view === "month" ? period.month : 1;
	const lastMonth = period.view === "month" ? period.month : 12;
	const start = HebrewDate.fromHebrewComponents(
		period.year,
		uniformMonthToTemporalMonthCode(firstMonth, isHebrewLeapYear(period.year)),
		1,
	);
	const lastStart = HebrewDate.fromHebrewComponents(
		period.year,
		uniformMonthToTemporalMonthCode(lastMonth, isHebrewLeapYear(period.year)),
		1,
	);
	const after = nextMonth({
		year: lastStart.year,
		month: lastStart.getUniformMonth(),
	});
	const end = HebrewDate.fromHebrewComponents(
		after.year,
		uniformMonthToTemporalMonthCode(after.month, isHebrewLeapYear(after.year)),
		1,
	).add(-1);
	const first = eligible[0];
	const last = eligible[eligible.length - 1];
	if (end.deltaDays(first.start) < 0 || start.deltaDays(last.end) > 0)
		return false;
	// A boundary month/year must not export another cycle's scheduled days.
	if (first.number > 1 && start.deltaDays(getCycle(first.number - 1).end) <= 0)
		return false;
	return end.deltaDays(getCycle(last.number + 1).start) < 0;
}
