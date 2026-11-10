import { describe, expect, it } from "vitest";
import {
	bulletinDatesForRun,
	isBulletinHoliday,
	scheduledBulletinDate,
} from "~/lib/bulletin-schedule";

describe("legacy Israeli bulletin calendar", () => {
	it("runs today and next on Sunday, with no Friday/Saturday bulletin", () => {
		expect(bulletinDatesForRun("2026-10-29")).toEqual(["2026-10-29"]);
		expect(bulletinDatesForRun("2026-10-30")).toEqual([]);
		expect(bulletinDatesForRun("2026-10-31")).toEqual([]);
		expect(bulletinDatesForRun("2026-11-01")).toEqual(["2026-11-01"]);
	});
	it("advances both weekday Rosh Hashana bulletins, but never a Friday", () => {
		expect(bulletinDatesForRun("2025-09-22")).toEqual([
			"2025-09-22",
			"2025-09-23",
			"2025-09-24",
		]);
		expect(bulletinDatesForRun("2025-09-23")).toEqual([]);
		expect(bulletinDatesForRun("2025-09-24")).toEqual([]);
		expect(bulletinDatesForRun("2024-10-02")).toEqual([
			"2024-10-02",
			"2024-10-03",
		]);
	});
	it.each([
		"2026-09-12",
		"2026-09-13",
		"2026-09-21",
		"2026-09-26",
		"2026-10-03",
		"2026-04-02",
		"2026-04-08",
		"2026-05-22",
	])("recognizes Israeli yom tov %s", (date) => {
		expect(isBulletinHoliday(date)).toBe(true);
		expect(bulletinDatesForRun(date)).toEqual([]);
	});
	it("advances a Wednesday festival and keeps Israeli chol hamoed study days", () => {
		expect(bulletinDatesForRun("2026-04-07")).toEqual([
			"2026-04-07",
			"2026-04-08",
		]);
		expect(isBulletinHoliday("2026-04-03")).toBe(false);
		expect(bulletinDatesForRun("2026-04-05")).toEqual(["2026-04-05"]);
		expect(bulletinDatesForRun("2026-05-21")).toEqual(["2026-05-21"]);
	});
	it("rejects invalid dates instead of normalizing them", () => {
		expect(() => bulletinDatesForRun("2026-02-30")).toThrow();
	});
});
describe("AWS scheduled timestamp", () => {
	it("uses Jerusalem 10AM across winter and summer offsets", () => {
		expect(
			scheduledBulletinDate(
				"2026-10-29T08:00:00Z",
				new Date("2026-10-29T08:00:59Z"),
			),
		).toBe("2026-10-29");
		expect(
			scheduledBulletinDate(
				"2027-07-01T07:00:00Z",
				new Date("2027-07-01T07:01:00Z"),
			),
		).toBe("2027-07-01");
		expect(
			scheduledBulletinDate(
				"2027-07-01T08:00:00Z",
				new Date("2027-07-01T08:00:00Z"),
			),
		).toBeNull();
	});
	it.each([
		null,
		{},
		"2026-02-30T08:00:00Z",
		"invalid",
		"2026-10-29T08:00:00+00:00",
		"2026-10-29T08:00:01Z",
		"2026-10-29T08:01:00Z",
		"2026-10-28T08:00:00Z",
		"2026-10-30T08:00:00Z",
	])("refuses stale, future or noncanonical invocation %j", (value) => {
		expect(
			scheduledBulletinDate(value, new Date("2026-10-29T08:05:00Z")),
		).toBeNull();
	});
	it("rejects oversized timestamp input before parsing", () => {
		expect(scheduledBulletinDate("9".repeat(1_000_000), new Date())).toBeNull();
	});
	it("rejects an invalid clock", () => {
		expect(
			scheduledBulletinDate("2026-10-29T08:00:00Z", new Date(Number.NaN)),
		).toBeNull();
	});
});
