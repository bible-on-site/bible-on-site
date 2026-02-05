import { toLetters } from "gematry";
import { getTwilight } from "sunrise-sunset-js";
import { Temporal } from "temporal-polyfill";

// Jerusalem coordinates for tzeit calculation
const JERUSALEM_LAT = 31.778;
const JERUSALEM_LON = 35.235;

/**
 * Map from uniform month number (used in our date number format) to Temporal month code
 * Uniform months: 1=Tishrei, 2=Cheshvan, ..., 5=Shevat, 6=Adar, ..., 12=Elul, 13=Adar I, 14=Adar II
 */
function uniformMonthToTemporalMonthCode(
	uniformMonth: number,
	isLeapYear: boolean,
): string {
	if (uniformMonth >= 1 && uniformMonth <= 5) {
		// Tishrei through Shevat
		return `M0${uniformMonth}`;
	}
	if (uniformMonth === 6 && !isLeapYear) {
		// Adar in non-leap year
		return "M06";
	}
	if (uniformMonth >= 7 && uniformMonth <= 12) {
		// Nisan through Elul (offset by 1 for Temporal)
		return uniformMonth <= 9 ? `M0${uniformMonth}` : `M${uniformMonth}`;
	}
	if (uniformMonth === 13) {
		// Adar I in leap year
		return "M05L";
	}
	if (uniformMonth === 14) {
		// Adar II in leap year
		return "M06";
	}
	/* istanbul ignore next: defensive - should never happen with valid data */
	throw new Error(`Invalid uniform month: ${uniformMonth}`);
}

/**
 * Convert Temporal month code to uniform month number
 */
function temporalMonthCodeToUniformMonth(
	monthCode: string,
	isLeapYear: boolean,
): number {
	// Handle Adar I (leap year)
	if (monthCode === "M05L") {
		return 13;
	}

	const monthNum = Number.parseInt(monthCode.substring(1), 10);

	// Months 1-5 (Tishrei-Shevat) are the same
	if (monthNum <= 5) {
		return monthNum;
	}

	// Month 6 is Adar (non-leap) or Adar II (leap)
	if (monthNum === 6) {
		return isLeapYear ? 14 : 6;
	}

	// Months 7-12 (Nisan-Elul)
	return monthNum;
}

/**
 * Wrapper around Temporal PlainDate with Hebrew calendar
 * Provides an API similar to the old HDate class
 */
export class HebrewDate {
	private readonly date: Temporal.PlainDate;

	constructor(date: Temporal.PlainDate) {
		this.date = date.withCalendar("hebrew");
	}

	static fromGregorian(gregorianDate: Date): HebrewDate {
		const plainDate = Temporal.PlainDate.from({
			year: gregorianDate.getFullYear(),
			month: gregorianDate.getMonth() + 1, // JS months are 0-indexed
			day: gregorianDate.getDate(),
		});
		return new HebrewDate(plainDate);
	}

	static fromHebrewComponents(
		year: number,
		monthCode: string,
		day: number,
	): HebrewDate {
		const plainDate = Temporal.PlainDate.from({
			year,
			monthCode,
			day,
			calendar: "hebrew",
		});
		return new HebrewDate(plainDate);
	}

	get year(): number {
		return this.date.year;
	}

	get month(): number {
		return this.date.month;
	}

	get monthCode(): string {
		return this.date.monthCode;
	}

	get day(): number {
		return this.date.day;
	}

	get dayOfWeek(): number {
		return this.date.dayOfWeek % 7; // Temporal: 1=Monday, 7=Sunday; we want 0=Sunday
	}

	isLeapYear(): boolean {
		return this.date.inLeapYear;
	}

	/**
	 * Get the uniform month number (1-12 for regular months, 13-14 for Adar I/II in leap years)
	 */
	getUniformMonth(): number {
		return temporalMonthCodeToUniformMonth(
			this.date.monthCode,
			this.date.inLeapYear,
		);
	}

	/**
	 * Returns the next Hebrew date
	 */
	next(): HebrewDate {
		return new HebrewDate(this.date.add({ days: 1 }));
	}

	/**
	 * Add days to this date
	 * @param amount - number of days to add
	 * @param _unit - unit (only DAYS is supported, kept for API compatibility)
	 */
	add(amount: number, _unit?: DateUnits): HebrewDate {
		return new HebrewDate(this.date.add({ days: amount }));
	}

	/**
	 * Get the day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
	 * Compatible with old HDate.getDay() API
	 */
	getDay(): number {
		// Temporal: dayOfWeek is 1=Monday, 7=Sunday
		// We want: 0=Sunday, 1=Monday, ..., 6=Saturday
		return this.date.dayOfWeek === 7 ? 0 : this.date.dayOfWeek;
	}

	/**
	 * Calculate the difference in days between this date and another
	 * Returns positive if this date is after other (this - other)
	 * Returns negative if this date is before other
	 */
	deltaDays(other: HebrewDate): number {
		// Convert both to ISO calendar for comparison
		const thisIso = this.date.withCalendar("iso8601");
		const otherIso = other.date.withCalendar("iso8601");
		// Temporal.until returns (other - this), we want (this - other)
		return -thisIso.until(otherIso, { largestUnit: "days" }).days;
	}

	/**
	 * Find the nearest occurrence of a specific day of week
	 * If today is that day, returns today
	 */
	nearest(dayOfWeek: DayOfWeek): HebrewDate {
		const currentDay = this.getDay();
		if (currentDay === dayOfWeek) {
			return this;
		}

		// Calculate days to go back or forward
		let daysBack = currentDay - dayOfWeek;
		if (daysBack < 0) daysBack += 7;

		let daysForward = dayOfWeek - currentDay;
		if (daysForward < 0) daysForward += 7;

		// Return the closer one (prefer going back if equal)
		if (daysBack <= daysForward) {
			return new HebrewDate(this.date.subtract({ days: daysBack }));
		}
		return new HebrewDate(this.date.add({ days: daysForward }));
	}

	/**
	 * Returns a string representation of the Hebrew date (English locale)
	 */
	toString(): string {
		return this.date.toLocaleString("en-u-ca-hebrew", {
			day: "numeric",
			month: "long",
			year: "numeric",
		});
	}

	/**
	 * Returns the Hebrew date in Hebrew script for display (he-IL locale, hebrew calendar).
	 */
	toHebrewLocaleString(): string {
		return this.date.toLocaleString("he-IL-u-ca-hebrew", {
			day: "numeric",
			month: "long",
			year: "numeric",
		});
	}

	/**
	 * Traditional Hebrew date format: day (Hebrew letters + geresh), month name, year (e.g. י"ח שבט התשפ"ו).
	 * Uses standard Intl for month name and gematry (project dependency) for day/year letters.
	 */
	toTraditionalHebrewString(): string {
		const dayStr = toLetters(this.day, { addQuotes: true });
		const monthStr = this.date.toLocaleString("he-IL-u-ca-hebrew", {
			month: "long",
		});
		const yearStr =
			this.year >= 5000
				? `ה'${toLetters(this.year - 5000, { addQuotes: true })}`
				: toLetters(this.year, { addQuotes: true });
		return `${dayStr} ${monthStr} ${yearStr}`;
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

/**
 * Calculate tzeit hakochavim (nightfall) for Jerusalem
 * Uses civil twilight (sun at -6°) as a reasonable approximation for tzeit
 * Halachic tzeit is typically at sun -7.083° to -8.5° depending on opinion
 */
function calculateTset(date: Date): Date {
	const twilight = getTwilight(JERUSALEM_LAT, JERUSALEM_LON, date, {
		timezoneId: "Asia/Jerusalem",
	});

	/* istanbul ignore next: only happens in polar region, which Jerusalem is not */
	if (!twilight?.civilDusk) {
		throw new Error("Unable to calculate tzeit for the given date/location");
	}

	return twilight.civilDusk;
}

/**
 * Constructs a Hebrew date that is aware of tzeit (nightfall)
 * If the current time is after tzeit, returns the next Hebrew day
 */
export function constructTsetAwareHDate(date: Date): HebrewDate {
	const tset = calculateTset(date);
	const initialHDate = HebrewDate.fromGregorian(date);

	if (date.getTime() > tset.getTime()) {
		return initialHDate.next();
	}
	return initialHDate;
}

/**
 * Converts a HebrewDate to a numeric format: YYYYMMDD
 * Where YYYY is the Hebrew year, MM is the uniform month (01-14), DD is the day
 */
export function hebcalDateToNumber(hDate: HebrewDate): number {
	const uniformMonth = hDate.getUniformMonth();
	return Number.parseInt(
		`${hDate.year}${uniformMonth.toString().padStart(2, "0")}${hDate.day.toString().padStart(2, "0")}`,
		10,
	);
}

/**
 * Parses a numeric date (YYYYMMDD) back to a HebrewDate
 */
export function parseNumericalDateToHebcalDate(
	dateAsNumber: number,
): HebrewDate {
	const dateStr = dateAsNumber.toString();
	const year = Number.parseInt(dateStr.substring(0, 4), 10);
	const uniformMonth = Number.parseInt(dateStr.substring(4, 6), 10);
	const day = Number.parseInt(dateStr.substring(6), 10);

	// Determine if it's a leap year to correctly interpret the month
	const isLeapYear = isHebrewLeapYear(year);
	const monthCode = uniformMonthToTemporalMonthCode(uniformMonth, isLeapYear);

	return HebrewDate.fromHebrewComponents(year, monthCode, day);
}

/**
 * Check if a Hebrew year is a leap year
 * Hebrew leap years follow a 19-year Metonic cycle: years 3, 6, 8, 11, 14, 17, 19
 */
function isHebrewLeapYear(year: number): boolean {
	const yearInCycle = ((year - 1) % 19) + 1;
	return [3, 6, 8, 11, 14, 17, 19].includes(yearInCycle);
}
