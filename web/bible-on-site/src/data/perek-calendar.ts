import moment from "moment-timezone";
import { getCurrentDate } from "@/util/date";
import {
	constructTsetAwareHDate,
	DateUnits,
	DayOfWeek,
	type HebrewDate,
	hebcalDateToNumber,
	parseNumericalDateToHebcalDate,
} from "@/util/hebdates-util";
import catalog from "./db/client-catalog.generated.json";
import { cycles } from "./db/cycles";

export function getPerekIdByDate(date: Date): number {
	const floorToThursdayAtWeekend = (hDate: HebrewDate): HebrewDate =>
		(hDate.getDay() as DayOfWeek) === DayOfWeek.FRIDAY ||
		(hDate.getDay() as DayOfWeek) === DayOfWeek.SATURDAY
			? hDate.nearest(DayOfWeek.THURSDAY)
			: hDate;

	const roundToCycle = (hDate: HebrewDate): HebrewDate => {
		const cycleHDates = cycles.map(parseNumericalDateToHebcalDate);
		const CYCLE_LENGTH = 1299;
		for (const cycleHDate of cycleHDates) {
			// before a cycle
			if (hDate.deltaDays(cycleHDate) < 0) {
				// return next cycle start date
				return cycleHDate;
			}
			// during a cycle
			if (
				hDate.deltaDays(cycleHDate.add(CYCLE_LENGTH - 1, DateUnits.DAYS)) < 0
			) {
				// no need to round
				return hDate;
			}
		}
		// after all cycles
		const lastCycleHDate = cycleHDates.at(-1);
		/* istanbul ignore next: should never happen */
		if (!lastCycleHDate) {
			throw new Error("no cycles data found");
		}
		// return last cycle end date
		return lastCycleHDate.add(CYCLE_LENGTH - 1);
	};

	const getLearningHDate = (date: Date): HebrewDate => {
		const tsetAwareHDate = constructTsetAwareHDate(date);
		const weekendAwareHdate = floorToThursdayAtWeekend(tsetAwareHDate);
		const cycleAwareHDate = roundToCycle(weekendAwareHdate);
		return cycleAwareHDate;
	};

	const hDate: HebrewDate = getLearningHDate(date);

	const hebDateAsNumber = hebcalDateToNumber(hDate);

	const perek = catalog.schedule.find((p) => p.date.includes(hebDateAsNumber));
	/* istanbul ignore next: should never happen */
	if (!perek) {
		throw new Error(`No perek found for date: ${hDate.toString()}`);
	}
	return perek.perekId;
}

/**
 * Get the perek ID for today.
 */
export function getTodaysPerekId() {
	return getPerekIdByDate(
		moment.tz(getCurrentDate(), "Asia/Jerusalem").toDate(),
	);
}
