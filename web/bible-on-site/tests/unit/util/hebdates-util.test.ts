import { parseKosherChristianDate } from "../../util/dates";

import { HDate, months } from "@hebcal/core";
import {
	constructTsetAwareHDate,
	hebcalDateToNumber,
	parseNumericalDateToHebcalDate,
} from "../../../src/util/hebdates-util";

describe("constructTsetAwareHDate", () => {
	describe("when before tset", () => {
		it("returns the same date", () => {
			const date = parseKosherChristianDate("27/June/24", "18:00:00");
			const actual = constructTsetAwareHDate(date);
			expect(actual.toString()).toBe("21 Sivan 5784");
		});
	});
	describe("when after tset", () => {
		it("returns the next day", () => {
			const date = parseKosherChristianDate("27/June/24", "21:00:00");
			const actual = constructTsetAwareHDate(date);
			expect(actual.toString()).toBe("22 Sivan 5784");
		});
	});
});
describe("hebcalDateToNumber", () => {
	describe("when leap year", () => {
		describe("when 1 Sh'vat 5784", () => {
			it("returns month 05", () => {
				const hDate = new HDate(1, months.SHVAT, 5784);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57840501);
			});
		});
		describe("when 21 Sivan 5784", () => {
			it("returns month 09", () => {
				const hDate = new HDate(21, months.SIVAN, 5784);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57840921);
			});
		});
		describe("when 15 Adar I 5784", () => {
			it("returns month 13", () => {
				const hDate = new HDate(15, months.ADAR_I, 5784);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57841315);
			});
		});
		describe("when 20 Adar II 5784", () => {
			it("returns month 14", () => {
				const hDate = new HDate(20, months.ADAR_II, 5784);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57841420);
			});
		});
	});
	describe("when non-leap year", () => {
		describe("when 1 Sh'vat 5783", () => {
			it("returns month 05", () => {
				const hDate = new HDate(1, months.SHVAT, 5783);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57830501);
			});
		});
		describe("when 21 Sivan 5783", () => {
			it("returns month 09", () => {
				const hDate = new HDate(21, months.SIVAN, 5783);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57830921);
			});
		});
		describe("when 15 Adar 5783", () => {
			it("returns month 06", () => {
				const hDate = new HDate(15, months.ADAR_I, 5783);
				const actual = hebcalDateToNumber(hDate);
				expect(actual).toBe(57830615);
			});
		});
	});
});

describe("parseNumericalDateToHebcalDate", () => {
	describe("when leap year", () => {
		describe("when month is 05", () => {
			it("returns Sh'vat", () => {
				const actual = parseNumericalDateToHebcalDate(57840501);
				expect(actual.toString()).toBe("1 Sh'vat 5784");
			});
		});
		describe("when month is 09", () => {
			it("returns Sivan", () => {
				const actual = parseNumericalDateToHebcalDate(57840921);
				expect(actual.toString()).toBe("21 Sivan 5784");
			});
		});
		describe("when month is 13", () => {
			it("returns Adar I", () => {
				const actual = parseNumericalDateToHebcalDate(57841315);
				expect(actual.toString()).toBe("15 Adar I 5784");
			});
		});
		describe("when month is 14", () => {
			it("returns Adar II", () => {
				const actual = parseNumericalDateToHebcalDate(57841420);
				expect(actual.toString()).toBe("20 Adar II 5784");
			});
		});
	});
	describe("when non leap year", () => {
		describe("when month is 05", () => {
			it("returns Sh'vat", () => {
				const actual = parseNumericalDateToHebcalDate(57830501);
				expect(actual.toString()).toBe("1 Sh'vat 5783");
			});
		});
		describe("when month is 09", () => {
			it("returns Sivan", () => {
				const actual = parseNumericalDateToHebcalDate(57830921);
				expect(actual.toString()).toBe("21 Sivan 5783");
			});
		});
		describe("when month is 6", () => {
			it("returns Adar", () => {
				const actual = parseNumericalDateToHebcalDate(57831315);
				expect(actual.toString()).toBe("15 Adar 5783");
			});
		});
	});
});
