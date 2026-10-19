import { toLetters } from "gematry";
import {
	HebrewDate,
	hebcalDateToNumber,
	isHebrewLeapYear,
	parseNumericalDateToHebcalDate,
	uniformMonthToTemporalMonthCode,
} from "@/util/hebdates-util";
import catalog from "./db/client-catalog.generated.json";
import { cycles } from "./db/cycles";

/**
 * Daily-learning (929) schedule for the לוח לימוד יומי calendar.
 *
 * Confirmed cycles come from the canonical perakim date arrays
 * (client-catalog.generated.json, backed by the same schedule the app queries
 * in tanah_perek_date). Each confirmed cycle spans exactly 1299 days:
 * perek 1 on its first day and perek 929 on day 1298, with three unscheduled
 * days between one cycle's end and the next cycle's start.
 *
 * Review days are dates inside a cycle with no scheduled perek (weekend or
 * shifted study days in the schedule data). They review all perakim studied
 * in the same calendar week (Sunday through the review day) — never a newly
 * assigned chapter. When a gap leaves a week without any study day, the
 * review falls back to the most recently scheduled perek.
 *
 * Cycles beyond the confirmed data follow the established scheduling rules:
 * every cycle starts on Sunday exactly 1302 days after the previous one, with
 * perakim assigned Sunday–Thursday and Friday/Saturday as review days.
 * Projected cycles are clearly marked so the UI can distinguish them.
 */

export const CYCLE_DAYS = 1299;
export const CYCLE_SPAN_DAYS = 1302; // 1299-day cycle + 3 unscheduled gap days
export const PERAKIM_PER_CYCLE = 929;
export const STUDY_DAYS_PER_WEEK = 5; // Sunday–Thursday in projected cycles

export interface StudyCycle {
	/** 1-based cycle number. */
	number: number;
	/** Hebrew date of the first study day (perek 1). */
	start: HebrewDate;
	/** Hebrew date of the last study day (perek 929). */
	end: HebrewDate;
	/** True for cycles derived from the scheduling rules rather than stored data. */
	projected: boolean;
}

export type CalendarDayStatus = "study" | "review" | "none";

export interface CalendarDay {
	date: HebrewDate;
	/** Hebrew date as YYYYMMDD (uniform month numbering). */
	dateNumber: number;
	/** Day of month (1-30). */
	day: number;
	/** Day of week: 0=Sunday … 6=Saturday. */
	dayOfWeek: number;
	status: CalendarDayStatus;
	/** Scheduled perek on study days; last perek of the review set on review days. */
	perekId?: number;
	/** Every perek the review covers — the week's studied perakim (#2365). */
	reviewPerekIds?: number[];
	/** Owning cycle number, when the date falls inside a cycle. */
	cycle?: number;
	/** True when the owning cycle is projected beyond confirmed data. */
	projected?: boolean;
}

export interface MonthCell {
	/** Day payload; undefined for the leading blanks before the 1st of the month. */
	day?: CalendarDay;
	/** Weekday column (0 = Sunday) of a blank placeholder cell. */
	blankColumn?: number;
}

interface ScheduleEntry {
	perekId: number;
	dateNumber: number;
	date: HebrewDate;
}

interface ConfirmedCycle {
	start: HebrewDate;
	end: HebrewDate;
	/** Entries in schedule order, which is also chronological order. */
	entries: ScheduleEntry[];
}

let confirmedCycles: ConfirmedCycle[] | undefined;

function getConfirmedCycles(): ConfirmedCycle[] {
	if (confirmedCycles) {
		return confirmedCycles;
	}
	const perCycle: ScheduleEntry[][] = cycles.map(() => []);
	for (const { perekId, date } of catalog.schedule) {
		date.forEach((dateNumber, cycleIndex) => {
			perCycle[cycleIndex]?.push({
				perekId,
				dateNumber,
				date: parseNumericalDateToHebcalDate(dateNumber),
			});
		});
	}
	confirmedCycles = cycles.map((startNumber, index) => {
		const start = parseNumericalDateToHebcalDate(startNumber);
		// perCycle is built with exactly cycles.length slots.
		const entries = perCycle[index];
		// Keep entries in chronological order; the source arrays are in perek
		// order which is the schedule's assignment order.
		entries.sort((a, b) => a.date.deltaDays(b.date));
		return {
			start,
			end: start.add(CYCLE_DAYS - 1),
			entries,
		};
	});
	return confirmedCycles;
}

/** Number of cycles backed by confirmed schedule data. */
export function getConfirmedCycleCount(): number {
	return cycles.length;
}

/**
 * Returns the cycle for a 1-based cycle number, projecting forward
 * (1302-day cadence) for numbers beyond the confirmed data.
 */
export function getCycle(cycleNumber: number): StudyCycle {
	if (cycleNumber < 1) {
		throw new Error(`Invalid cycle number: ${cycleNumber}`);
	}
	const confirmed = getConfirmedCycles();
	if (cycleNumber <= confirmed.length) {
		const { start, end } = confirmed[cycleNumber - 1];
		return { number: cycleNumber, start, end, projected: false };
	}
	let number = confirmed.length;
	let start = confirmed[confirmed.length - 1].start;
	while (number < cycleNumber) {
		start = start.add(CYCLE_SPAN_DAYS);
		number += 1;
	}
	return {
		number: cycleNumber,
		start,
		end: start.add(CYCLE_DAYS - 1),
		projected: true,
	};
}

/**
 * Returns the cycle that contains the given Hebrew date, or null when the
 * date is outside every cycle (before the program or in an inter-cycle gap).
 */
export function getCycleForDate(date: HebrewDate): StudyCycle | null {
	const confirmed = getConfirmedCycles();
	for (let index = 0; index < confirmed.length; index += 1) {
		const { start, end } = confirmed[index];
		const offset = date.deltaDays(start);
		if (offset < 0) {
			return null;
		}
		if (offset < CYCLE_DAYS) {
			return { number: index + 1, start, end, projected: false };
		}
	}
	// Beyond confirmed data: walk projected cycles.
	let cycleNumber = confirmed.length;
	let start = confirmed[confirmed.length - 1].start;
	for (;;) {
		cycleNumber += 1;
		start = start.add(CYCLE_SPAN_DAYS);
		const offset = date.deltaDays(start);
		if (offset < 0) {
			return null;
		}
		if (offset < CYCLE_DAYS) {
			return {
				number: cycleNumber,
				start,
				end: start.add(CYCLE_DAYS - 1),
				projected: true,
			};
		}
	}
}

/**
 * Resolves the daily-learning state of a single Hebrew date without any
 * clamping: dates outside the program resolve to "none" instead of silently
 * acquiring a perek.
 */
export function resolveCalendarDay(date: HebrewDate): CalendarDay {
	const dateNumber = hebcalDateToNumber(date);
	const base: Omit<CalendarDay, "status"> = {
		date,
		dateNumber,
		day: date.day,
		dayOfWeek: date.getDay(),
	};

	const confirmed = getConfirmedCycles();
	for (let index = 0; index < confirmed.length; index += 1) {
		const cycle = confirmed[index];
		const offset = date.deltaDays(cycle.start);
		if (offset < 0) {
			break;
		}
		if (offset < CYCLE_DAYS) {
			return resolveInCycle(date, base, cycle, index + 1);
		}
	}

	// Beyond confirmed data: project cycles until the date is reached.
	let cycleNumber = confirmed.length;
	let start = confirmed[confirmed.length - 1].start;
	for (;;) {
		cycleNumber += 1;
		start = start.add(CYCLE_SPAN_DAYS);
		const offset = date.deltaDays(start);
		if (offset < 0) {
			return { ...base, status: "none" };
		}
		if (offset < CYCLE_DAYS) {
			return resolveProjectedDay(base, offset, cycleNumber);
		}
	}
}

function resolveInCycle(
	date: HebrewDate,
	base: Omit<CalendarDay, "status">,
	cycle: ConfirmedCycle,
	cycleNumber: number,
): CalendarDay {
	// Index of the first entry dated on/after the bound. Entries are sorted
	// chronologically; the numeric date format is NOT chronological in leap
	// years (Adar II's uniform month 14 sorts above Nisan 7), so bounds must be
	// computed on the HebrewDate values, not the numbers.
	const lowerBound = (bound: HebrewDate): number => {
		let lo = 0;
		let hi = cycle.entries.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (cycle.entries[mid].date.deltaDays(bound) < 0) {
				lo = mid + 1;
			} else {
				hi = mid;
			}
		}
		return lo;
	};

	const dayIndex = lowerBound(date);
	const dayEntry = cycle.entries[dayIndex];
	if (dayEntry?.dateNumber === base.dateNumber) {
		return {
			...base,
			status: "study",
			perekId: dayEntry.perekId,
			cycle: cycleNumber,
		};
	}
	// In-cycle day without its own chapter: review the whole studied week
	// (Sunday of this week through yesterday), not just the last perek (#2365).
	const weekStart = date.add(-base.dayOfWeek);
	const weekStartIndex = lowerBound(weekStart);
	const weekPerekIds = cycle.entries
		.slice(weekStartIndex, dayIndex)
		.map((entry) => entry.perekId);
	/* istanbul ignore else: confirmed cycles never leave a study-less week */
	if (weekPerekIds.length > 0) {
		return {
			...base,
			status: "review",
			perekId: weekPerekIds[weekPerekIds.length - 1],
			reviewPerekIds: weekPerekIds,
			cycle: cycleNumber,
		};
	}
	// A gap that left no study day this week: fall back to the last perek.
	/* istanbul ignore next: defensive fallback, unreachable in confirmed data */
	const previousEntry = cycle.entries[dayIndex - 1];
	/* istanbul ignore next: defensive fallback, unreachable in confirmed data */
	if (previousEntry !== undefined) {
		return {
			...base,
			status: "review",
			perekId: previousEntry.perekId,
			reviewPerekIds: [previousEntry.perekId],
			cycle: cycleNumber,
		};
	}
	/* istanbul ignore next: every cycle starts with perek 1 on day 0 */
	return { ...base, status: "none" };
}

function resolveProjectedDay(
	base: Omit<CalendarDay, "status">,
	offset: number,
	cycleNumber: number,
): CalendarDay {
	const week = Math.floor(offset / 7);
	const dayOfWeekIndex = offset % 7;
	const isStudyDay = dayOfWeekIndex < STUDY_DAYS_PER_WEEK;
	const perekIndex = isStudyDay
		? week * STUDY_DAYS_PER_WEEK + dayOfWeekIndex
		: week * STUDY_DAYS_PER_WEEK + (STUDY_DAYS_PER_WEEK - 1);
	/* istanbul ignore if: offset < CYCLE_DAYS guarantees perekIndex < 929 */
	if (perekIndex >= PERAKIM_PER_CYCLE) {
		return { ...base, status: "none", cycle: cycleNumber, projected: true };
	}
	const reviewPerekIds = isStudyDay
		? undefined
		: Array.from(
				{
					length: Math.min(
						STUDY_DAYS_PER_WEEK,
						PERAKIM_PER_CYCLE - week * STUDY_DAYS_PER_WEEK,
					),
				},
				(_, i) => week * STUDY_DAYS_PER_WEEK + i + 1,
			);
	return {
		...base,
		status: isStudyDay ? "study" : "review",
		perekId: perekIndex + 1,
		reviewPerekIds,
		cycle: cycleNumber,
		projected: true,
	};
}

/**
 * Uniform month order within a Hebrew year.
 * Leap years place Adar I (13) and Adar II (14) between Shevat (5) and Nisan (7).
 */
export function getMonthOrder(year: number): number[] {
	return isHebrewLeapYear(year)
		? [1, 2, 3, 4, 5, 13, 14, 7, 8, 9, 10, 11, 12]
		: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
}

/** Builds all calendar cells for a uniform Hebrew month of a year. */
export function buildMonth(year: number, uniformMonth: number): MonthCell[] {
	const first = parseNumericalDateToHebcalDate(
		year * 10000 + uniformMonth * 100 + 1,
	);
	const cells: MonthCell[] = Array.from(
		{ length: first.getDay() },
		(_, column) => ({ blankColumn: column }),
	);
	let current = first;
	while (current.getUniformMonth() === uniformMonth && current.year === year) {
		cells.push({ day: resolveCalendarDay(current) });
		current = current.next();
	}
	return cells;
}

export interface MonthRef {
	year: number;
	/** Uniform month number (see getMonthOrder). */
	month: number;
}

/** Returns the month following the given one, crossing year boundaries. */
export function nextMonth({ year, month }: MonthRef): MonthRef {
	const order = getMonthOrder(year);
	const index = order.indexOf(month);
	if (index === -1) {
		throw new Error(`Month ${month} does not exist in year ${year}`);
	}
	return index + 1 < order.length
		? { year, month: order[index + 1] }
		: { year: year + 1, month: 1 };
}

/** Returns the month preceding the given one, crossing year boundaries. */
export function prevMonth({ year, month }: MonthRef): MonthRef {
	const order = getMonthOrder(year);
	const index = order.indexOf(month);
	if (index === -1) {
		throw new Error(`Month ${month} does not exist in year ${year}`);
	}
	return index > 0
		? { year, month: order[index - 1] }
		: // Every Hebrew year ends with Elul (uniform month 12).
			{ year: year - 1, month: 12 };
}

/**
 * Orders two month references chronologically:
 * negative when a precedes b, zero when equal, positive otherwise.
 */
export function compareMonths(a: MonthRef, b: MonthRef): number {
	if (a.year !== b.year) {
		return a.year - b.year;
	}
	const order = getMonthOrder(a.year);
	return order.indexOf(a.month) - order.indexOf(b.month);
}

/** Hebrew month name for a uniform month (e.g. "אדר א" in a leap year). */
export function getMonthName(year: number, uniformMonth: number): string {
	const monthCode = uniformMonthToTemporalMonthCode(
		uniformMonth,
		isHebrewLeapYear(year),
	);
	return HebrewDate.fromHebrewComponents(year, monthCode, 1).toMonthName();
}

/** Hebrew year in letters following the site convention (e.g. ה'תשפ"ו). */
export function getYearLabel(year: number): string {
	return year >= 5000
		? `ה'${toLetters(year - 5000, { addQuotes: true })}`
		: toLetters(year, { addQuotes: true });
}

/** "חשוון ה'תשפ"ו" style month label. */
export function getMonthLabel({ year, month }: MonthRef): string {
	return `${getMonthName(year, month)} ${getYearLabel(year)}`;
}

/** Full Hebrew date label for a day (e.g. כ"ט כסלו ה'תשע"ה). */
export function getDateLabel(date: HebrewDate): string {
	return date.toTraditionalHebrewString();
}

/** Cycle display text: "מחזור 4" with its date range. */
export function getCycleLabel(cycle: StudyCycle): string {
	const projectedSuffix = cycle.projected ? " (משוער)" : "";
	return `מחזור ${cycle.number}${projectedSuffix}: ${cycle.start.toTraditionalHebrewString()} - ${cycle.end.toTraditionalHebrewString()}`;
}

/**
 * Readable sefer/perek reference such as "שמואל ב ה", built from the
 * lightweight client catalog volumes — no scripture bodies are loaded.
 */
export function getPerekSource(perekId: number): string {
	const volume = catalog.volumes.find(
		(v) => v.perekFrom <= perekId && v.perekTo >= perekId,
	);
	/* istanbul ignore next: catalog covers 1..929 */
	if (!volume) {
		throw new Error(`No volume found for perekId: ${perekId}`);
	}
	return `${volume.name} ${toLetters(perekId - volume.perekFrom + 1)}`;
}

/** MonthRef of the Hebrew month containing a cycle's first day. */
export function getCycleStartMonth(cycle: StudyCycle): MonthRef {
	return { year: cycle.start.year, month: cycle.start.getUniformMonth() };
}
