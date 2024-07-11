import { HDate, Location, Zmanim } from "@hebcal/core";

function extractUniformMonthNumberFromHDate(hDate: HDate): number {
	const hDateMonth = hDate.getTishreiMonth();
	// regular case: all months of non-leap year, or months Tishrei-Shevat of leap year
	if (hDateMonth < 6 || !hDate.isLeapYear()) {
		return hDateMonth;
	}
	// months Adar I and Adar II of leap year
	if (hDateMonth === 6 || hDateMonth === 7) {
		return hDateMonth + 7;
	}
	// months Nisan-Elul of leap year
	return hDateMonth - 1;
}
function extractHebcalMonthNumberfromNumericDate(date: number): number {
	const uniformMonth = Number.parseInt(date.toString().substring(4, 6));
	// if leap year and months Adar I or Adar II
	if (uniformMonth === 13 || uniformMonth === 14) {
		return uniformMonth - 1;
	}
	// for all months of non-leap year, or months Tishrei-Shevat and Nisan-Elul of leap year
	return ((uniformMonth + 5) % 12) + 1;
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
const JERUSALEM = new Location(31.778, 35.235, true, "Asia/Jerusalem");
const calculateTset = (date: Date): Date =>
	new Zmanim(JERUSALEM, date, true).tzeit(7);

const advanceDayIfAfterTset = (hDate: HDate, date: Date, tset: Date): HDate =>
	date.getTime() > tset.getTime() ? hDate.next() : hDate;

export function constructTsetAwareHDate(date: Date): HDate {
	const tset = calculateTset(date);
	const initialHDate = new HDate(date);
	return advanceDayIfAfterTset(initialHDate, date, tset);
}

export function hebcalDateToNumber(hDate: HDate): number {
	return Number.parseInt(
		`${hDate.yy}${extractUniformMonthNumberFromHDate(hDate)
			.toString()
			.padStart(2, "0")}${hDate.dd.toString().padStart(2, "0")}`,
	);
}
export function parseNumericalDateToHebcalDate(dateAsNumber: number) {
	return new HDate(
		Number.parseInt(dateAsNumber.toString().substring(6)),
		extractHebcalMonthNumberfromNumericDate(dateAsNumber),
		Number.parseInt(dateAsNumber.toString().substring(0, 4)),
	);
}
