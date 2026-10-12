import { resolveCalendarDay } from "@/data/learning-schedule";
import { getCurrentDate } from "@/util/date";
import { constructTsetAwareHDate } from "@/util/hebdates-util";

/**
 * The perek a user should learn on the given day.
 *
 * Delegates to the shared learning schedule, so "today's perek" always agrees
 * with the לוח לימוד יומי calendar: scheduled days return their exact perek,
 * review days (weekends and shifted study days, including cycle-9 Saturdays)
 * return the perek being reviewed, and dates in projected future cycles follow
 * the same projection shown on the calendar.
 *
 * Dates with no schedule (before the program or in an inter-cycle gap) point
 * at the upcoming cycle's first perek, matching historical behavior.
 */
export function getPerekIdByDate(date: Date): number {
	const hDate = constructTsetAwareHDate(date);
	const calendarDay = resolveCalendarDay(hDate);
	return calendarDay.perekId ?? 1;
}

/**
 * Get the perek ID for today.
 */
export function getTodaysPerekId() {
	return getPerekIdByDate(getCurrentDate());
}
