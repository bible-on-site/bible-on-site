import {
	constructTsetAwareHDate,
	HebrewDate,
	hebcalDateToNumber,
	parseNumericalDateToHebcalDate,
} from "../../../src/util/hebdates-util";
import { parseKosherChristianDate } from "../../util/dates";

/**
 * Hebrew month codes for creating test dates
 * Using Temporal's ISO month code format
 */
const HebrewMonth = {
	TISHREI: "M01",
	CHESHVAN: "M02",
	KISLEV: "M03",
	TEVET: "M04",
	SHVAT: "M05",
	ADAR_I: "M05L", // Leap year only
	ADAR: "M06", // Non-leap year Adar, or Adar II in leap year
	NISAN: "M07",
	IYAR: "M08",
	SIVAN: "M09",
	TAMMUZ: "M10",
	AV: "M11",
	ELUL: "M12",
} as const;

describe("constructTsetAwareHDate", () => {
	describe("when before tset", () => {
		// TODO: investigate why falky between machines, despite using deterministic timezone
		it("returns the same date", () => {
			const date = parseKosherChristianDate("27/June/24", "08:00:00");
			const actual = constructTsetAwareHDate(date);
			expect(actual.toString()).toContain("21");
			expect(actual.toString()).toContain("Sivan");
			expect(actual.toString()).toContain("5784");
		});
	});
	describe("when after tset", () => {
		it("returns the next day", () => {
			const date = parseKosherChristianDate("27/June/24", "23:59:59");
			const actual = constructTsetAwareHDate(date);
			expect(actual.toString()).toContain("22");
			expect(actual.toString()).toContain("Sivan");
			expect(actual.toString()).toContain("5784");
		});
	});
});
describe("hebcalDateToNumber", () => {
	describe("when leap year", () => {
		describe("when 1 Sh'vat 5784", () => {
			it("returns month 05", () => {
				const hDate = HebrewDate.fromHebrewComponents(
					5784,
					HebrewMonth.SHVAT,
					1,
				);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57840501);
			});
		});
		describe("when 21 Sivan 5784", () => {
			it("returns month 09", () => {
				const hDate = HebrewDate.fromHebrewComponents(
					5784,
					HebrewMonth.SIVAN,
					21,
				);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57840921);
			});
		});
		describe("when 15 Adar I 5784", () => {
			it("returns month 13", () => {
				const hDate = HebrewDate.fromHebrewComponents(
					5784,
					HebrewMonth.ADAR_I,
					15,
				);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57841315);
			});
		});
		describe("when 20 Adar II 5784", () => {
			it("returns month 14", () => {
				const hDate = HebrewDate.fromHebrewComponents(
					5784,
					HebrewMonth.ADAR,
					20,
				);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57841420);
			});
		});
	});
	describe("when non-leap year", () => {
		describe("when 1 Sh'vat 5783", () => {
			it("returns month 05", () => {
				const hDate = HebrewDate.fromHebrewComponents(
					5783,
					HebrewMonth.SHVAT,
					1,
				);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57830501);
			});
		});
		describe("when 21 Sivan 5783", () => {
			it("returns month 09", () => {
				const hDate = HebrewDate.fromHebrewComponents(
					5783,
					HebrewMonth.SIVAN,
					21,
				);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57830921);
			});
		});
		describe("when 15 Adar 5783", () => {
			it("returns month 06", () => {
				const hDate = HebrewDate.fromHebrewComponents(
					5783,
					HebrewMonth.ADAR,
					15,
				);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57830615);
			});
		});
	});
});

describe("parseNumericalDateToHebcalDate", () => {
	describe("when leap year", () => {
		describe("when month is 05", () => {
			it("returns Shevat", () => {
				const actual = parseNumericalDateToHebcalDate(57840501);
				expect(actual.toString()).toContain("Shevat");
				expect(actual.day).toBe(1);
				expect(actual.year).toBe(5784);
			});
		});
		describe("when month is 09", () => {
			it("returns Sivan", () => {
				const actual = parseNumericalDateToHebcalDate(57840921);
				expect(actual.toString()).toContain("Sivan");
				expect(actual.day).toBe(21);
				expect(actual.year).toBe(5784);
			});
		});
		describe("when month is 13", () => {
			it("returns Adar I", () => {
				const actual = parseNumericalDateToHebcalDate(57841315);
				expect(actual.monthCode).toBe("M05L");
				expect(actual.day).toBe(15);
				expect(actual.year).toBe(5784);
			});
		});
		describe("when month is 14", () => {
			it("returns Adar II", () => {
				const actual = parseNumericalDateToHebcalDate(57841420);
				expect(actual.monthCode).toBe("M06");
				expect(actual.day).toBe(20);
				expect(actual.year).toBe(5784);
				expect(actual.isLeapYear()).toBe(true);
			});
		});
	});
	describe("when non leap year", () => {
		describe("when month is 05", () => {
			it("returns Shevat", () => {
				const actual = parseNumericalDateToHebcalDate(57830501);
				expect(actual.toString()).toContain("Shevat");
				expect(actual.day).toBe(1);
				expect(actual.year).toBe(5783);
			});
		});
		describe("when month is 09", () => {
			it("returns Sivan", () => {
				const actual = parseNumericalDateToHebcalDate(57830921);
				expect(actual.toString()).toContain("Sivan");
				expect(actual.day).toBe(21);
				expect(actual.year).toBe(5783);
			});
		});
		describe("when month is 6", () => {
			it("returns Adar", () => {
				const actual = parseNumericalDateToHebcalDate(57830615);
				expect(actual.monthCode).toBe("M06");
				expect(actual.day).toBe(15);
				expect(actual.year).toBe(5783);
				expect(actual.isLeapYear()).toBe(false);
			});
		});
	});
});
