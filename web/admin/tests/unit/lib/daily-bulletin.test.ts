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
