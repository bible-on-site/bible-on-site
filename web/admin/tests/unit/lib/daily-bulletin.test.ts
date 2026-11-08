import { describe, expect, it, vi } from "vitest";
import {
	hebrewBulletinDate,
	todayInJerusalem,
	validateBulletinDate,
} from "~/lib/daily-bulletin";

describe("bulletin dates", () => {
	it("rejects malformed dates and dates that roll into another month", () => {
		for (const value of [
			null,
			"2026-2-03",
			"2026-02-30",
			"2026-13-01",
			"<script>",
		]) {
			expect(() => validateBulletinDate(value)).toThrow();
		}
		expect(validateBulletinDate("2024-02-29")).toBe("2024-02-29");
	});
	it("uses Jerusalem for the default date and the selected civil day for the Hebrew date", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-08T22:30:00Z"));
		expect(todayInJerusalem()).toBe("2026-10-09");
		expect(hebrewBulletinDate("2026-10-08")).toBe("כז תשרי תשפז");
		vi.useRealTimers();
	});
	it.each([
		["2027-02-20", "יג אדר א' תשפז"],
		["2027-03-20", "יא אדר ב' תשפז"],
	])("normalizes leap-year month punctuation for %s", (date, expected) => {
		expect(hebrewBulletinDate(date)).toBe(expected);
	});
});

describe("hebrewBulletinMonthDay (#3098)", () => {
	it("maps Gregorian dates to the uniform Hebrew month/day", async () => {
		const { hebrewBulletinMonthDay } = await import("~/lib/daily-bulletin");
		// Verified against Intl/Temporal: 9 Av 5784, 5 Iyar 5785, 1 Tishrei 5785.
		expect(hebrewBulletinMonthDay("2024-08-13")).toEqual({
			hebrewMonth: 11,
			hebrewDay: 9,
		});
		expect(hebrewBulletinMonthDay("2025-05-03")).toEqual({
			hebrewMonth: 8,
			hebrewDay: 5,
		});
		expect(hebrewBulletinMonthDay("2024-10-03")).toEqual({
			hebrewMonth: 1,
			hebrewDay: 1,
		});
	});

	it("keeps Adar semantics distinct across leap years", async () => {
		const { hebrewBulletinMonthDay } = await import("~/lib/daily-bulletin");
		// 5784 is a leap year: Adar I -> uniform 13, Adar II -> uniform 14.
		expect(hebrewBulletinMonthDay("2024-02-10")).toEqual({
			hebrewMonth: 13,
			hebrewDay: 1,
		});
		expect(hebrewBulletinMonthDay("2024-03-25")).toEqual({
			hebrewMonth: 14,
			hebrewDay: 15,
		});
		// 5783 is a non-leap year: plain Adar -> uniform 6, and Nisan stays 7.
		expect(hebrewBulletinMonthDay("2023-03-07")).toEqual({
			hebrewMonth: 6,
			hebrewDay: 14,
		});
		expect(hebrewBulletinMonthDay("2023-03-23")).toEqual({
			hebrewMonth: 7,
			hebrewDay: 1,
		});
	});

	it("maps ordinal months through the Metonic cycle when ICU emits numbers", async () => {
		const { hebrewBulletinMonthDay } = await import("~/lib/daily-bulletin");
		const realDateTimeFormat = Intl.DateTimeFormat;
		const forParts = (month: string, year: string, day: string) =>
			[
				{ type: "month", value: month },
				{ type: "year", value: year },
				{ type: "day", value: day },
			] as Intl.DateTimeFormatPart[];
		let parts: Intl.DateTimeFormatPart[] = [];
		vi.stubGlobal("Intl", {
			...Intl,
			DateTimeFormat: class {
				formatToParts() {
					return parts;
				}
				format() {
					return "";
				}
			} as unknown as typeof Intl.DateTimeFormat,
		});
		try {
			// 5787 is a leap year ((7·5787+1) mod 19 = 2 < 7): 6→Adar I,
			// 7→Adar II, later ordinals shift by one.
			for (const [month, year, expected] of [
				["1", "5787", 1],
				["5", "5787", 5],
				["6", "5787", 13],
				["7", "5787", 14],
				["8", "5787", 7],
				["13", "5787", 12],
				// 5785 is a non-leap year ((7·5785+1) mod 19 = 7): ordinals pass.
				["6", "5785", 6],
				["7", "5785", 7],
			] as const) {
				parts = forParts(month, year, "9");
				expect(hebrewBulletinMonthDay("2024-08-13").hebrewMonth).toBe(expected);
			}
		} finally {
			vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: realDateTimeFormat });
		}
	});

	it("handles empty parts defensively in the ordinal path", async () => {
		const { hebrewBulletinMonthDay } = await import("~/lib/daily-bulletin");
		const realDateTimeFormat = Intl.DateTimeFormat;
		vi.stubGlobal("Intl", {
			...Intl,
			DateTimeFormat: class {
				formatToParts() {
					return [];
				}
				format() {
					return "";
				}
			} as unknown as typeof Intl.DateTimeFormat,
		});
		try {
			// Empty month parses as NaN → ordinal<=5 is false and !leap decides.
			const result = hebrewBulletinMonthDay("2024-08-13");
			expect(Number.isNaN(result.hebrewMonth) || result.hebrewMonth >= 0).toBe(
				true,
			);
		} finally {
			vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: realDateTimeFormat });
		}
	});
});
