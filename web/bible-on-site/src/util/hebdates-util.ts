import { HDate, Zmanim, Location } from "@hebcal/core";

function getMonthInDBFormatFromHebcalDate(hDate: HDate): number {
  const hDateMonth = hDate.getTishreiMonth();
  // regular case
  if (hDateMonth < 6 || !hDate.isLeapYear()) {
    return hDateMonth;
  } else if (hDateMonth === 6 || hDateMonth === 7) {
    return hDateMonth + 7;
  } // if (hDateMonth >= 8)
  else {
    return hDateMonth - 1;
  }
}
export enum DayOfWeek {
  SUNDAY = 0,
  MONDAY = 1,
  TUESDAY = 2,
  WEDNESDAY = 3,
  THURSDAY = 4,
  FRIDAY = 5,
  SATURDAY = 6,
}
export enum DateUnits {
  DAYS = "d",
}

const calculateTset = (date: Date): Date =>
  new Zmanim(Location.lookup("Jerusalem")!, date, true).tzeit(7);

const advanceDayIfAfterTset = (hDate: HDate, date: Date, tset: Date): HDate =>
  date.getTime() > tset.getTime() ? hDate.next() : hDate;

export function constructTsetAwareHDate(date: Date): HDate {
  const tset = calculateTset(date);
  const initialHDate = new HDate(date);
  return advanceDayIfAfterTset(initialHDate, date, tset);
}

export function hebcalDateToNumber(hDate: HDate): number {
  return parseInt(
    `${hDate.yy}${getMonthInDBFormatFromHebcalDate(hDate)
      .toString()
      .padStart(2, "0")}${hDate.dd.toString().padStart(2, "0")}`
  );
}
export function parseNumericalDateToHebcalDate(dateAsNumber: number) {
  return new HDate(
    parseInt(dateAsNumber.toString().substring(6)),
    parseInt(dateAsNumber.toString().substring(4, 6)),
    parseInt(dateAsNumber.toString().substring(0, 4))
  );
}
