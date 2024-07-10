import {
	DateUnits,
	DayOfWeek,
	constructTsetAwareHDate,
	hebcalDateToNumber,
	parseNumericalDateToHebcalDate,
} from "@/util/hebdates-util";
import { type HDate, Location, Zmanim } from "@hebcal/core";
import { toLetters } from "gematry";
import moment from "moment-timezone";
import { cycles } from "./db/cycles";
import { sefarim } from "./db/sefarim";
import type { Pasuk } from "./db/tanah-view-types";
import { getAllPerakim } from "./sefer-dto";
export interface PerekObj {
	perekId: number;
	perekHeb: string;
	header: string;
	pesukim: Pasuk[];
	helek: string;
	sefer: string;
	source: string;
}
export function getPerekByPerekId(perekId: number): PerekObj {
	if (perekId < 1 || perekId > 929) {
		throw new Error(`Invalid perekId: ${perekId}`);
	}
	const sefer = sefarim.find(
		(sefer) => sefer.perekFrom <= perekId && sefer.perekTo >= perekId,
	)!;
	const perekIdx = perekId - sefer.perekFrom;
	const perekNum = perekIdx + 1;
	const perekHeb = toLetters(perekNum);
	const perek = sefer.perakim.at(perekIdx)!;

	return {
		perekId: perekId,
		perekHeb: perekHeb,
		header: perek.header,
		pesukim: perek.pesukim,
		helek: sefer.helek,
		sefer: sefer.name,
		source: `${sefer.name} ${perekHeb}`,
	};
}

export function getPerekIdByDate(date: Date): number {
	const floorToThursdayAtWeekend = (hDate: HDate): HDate =>
		hDate.getDay() === DayOfWeek.FRIDAY || hDate.getDay() === DayOfWeek.SATURDAY
			? hDate.nearest(DayOfWeek.THURSDAY)
			: hDate;

	const roundToCycle = (hDate: HDate): HDate => {
		const cycleHDates = cycles.map(parseNumericalDateToHebcalDate);
		const CYCLE_LENGTH = 1299;
		for (const cycleHDate of cycleHDates) {
			if (hDate.deltaDays(cycleHDate) < 0) {
				return cycleHDate;
			}
			if (
				hDate.deltaDays(cycleHDate.add(CYCLE_LENGTH - 1, DateUnits.DAYS)) < 0
			) {
				return hDate;
			}
		}
		return cycleHDates.findLast(() => true)!;
	};

	const getLearningHDate = (date: Date): HDate => {
		const tsetAwareHDate = constructTsetAwareHDate(date);
		const weekendAwareHdate = floorToThursdayAtWeekend(tsetAwareHDate);
		const cycleAwareHDate = roundToCycle(weekendAwareHdate);
		return cycleAwareHDate;
	};

	const hDate: HDate = getLearningHDate(date);

	const hebDateAsNumber = hebcalDateToNumber(hDate);

	return getAllPerakim().find((p) => p.date.includes(hebDateAsNumber))!.perekId;
}
export function getTodaysPerekId() {
	return getPerekIdByDate(moment.tz(new Date(), "Asia/Jerusalem").toDate());
}
