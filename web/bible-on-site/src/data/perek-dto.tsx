import {
  DateUnits,
  DayOfWeek,
  constructTsetAwareHDate,
  hebcalDateToNumber,
  parseNumericalDateToHebcalDate,
} from "@/util/hebdates-util";
import { type HDate } from "@hebcal/core";
import { toLetters } from "gematry";
import moment from "moment-timezone";
import { cycles } from "./db/cycles";
import { sefarim } from "./db/sefarim";
import type {
  Additionals,
  Pasuk,
  SefarimItemWithPerakim,
} from "./db/tanah-view-types";
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
    (sefer) => sefer.perekFrom <= perekId && sefer.perekTo >= perekId
  );
  if (!sefer) {
    throw new Error(`No sefer found for perekId: ${perekId}`);
  }

  const seferOrAdditional: SefarimItemWithPerakim | Additionals | undefined =
    "additionals" in sefer
      ? sefer.additionals.find(
          (a) => a.perekFrom <= perekId && a.perekTo >= perekId
        )
      : sefer;
  if (!seferOrAdditional) {
    throw new Error(
      `Addtionals perakim range is different from their sefer (${sefer.name}) perakim range`
    );
  }
  const perekNum = perekId - sefer.perekFrom + 1;
  const perekIdx = perekNum - 1;
  const perek = seferOrAdditional.perakim.at(perekIdx);
  if (!perek) {
    throw new Error(`No perek found for perekId: ${perekId}`);
  }
  const perekHeb = toLetters(perekNum);
  return {
    perekId,
    perekHeb,
    header: perek.header,
    pesukim: perek.pesukim,
    helek: sefer.helek,
    sefer: sefer.name,
    source: `${sefer.name} ${perekHeb}`,
  };
}

export function getPerekIdByDate(date: Date): number {
  const floorToThursdayAtWeekend = (hDate: HDate): HDate =>
    (hDate.getDay() as DayOfWeek) === DayOfWeek.FRIDAY ||
    (hDate.getDay() as DayOfWeek) === DayOfWeek.SATURDAY
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
    const lastCycleHDate = cycleHDates.at(-1);
    if (!lastCycleHDate) {
      throw new Error("no cycles data found");
    }
    return lastCycleHDate;
  };

  const getLearningHDate = (date: Date): HDate => {
    const tsetAwareHDate = constructTsetAwareHDate(date);
    const weekendAwareHdate = floorToThursdayAtWeekend(tsetAwareHDate);
    const cycleAwareHDate = roundToCycle(weekendAwareHdate);
    return cycleAwareHDate;
  };

  const hDate: HDate = getLearningHDate(date);

  const hebDateAsNumber = hebcalDateToNumber(hDate);

  const perek = getAllPerakim().find((p) => p.date.includes(hebDateAsNumber));
  if (!perek) {
    throw new Error(`No perek found for date: ${hDate.toString()}`);
  }
  return perek.perekId;
}
export function getTodaysPerekId() {
  return getPerekIdByDate(moment.tz(new Date(), "Asia/Jerusalem").toDate());
}
