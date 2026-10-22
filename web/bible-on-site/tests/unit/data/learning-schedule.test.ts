import { toLetters } from "gematry";
import {
	buildMonth,
	compareMonths,
	CYCLE_DAYS,
	CYCLE_SPAN_DAYS,
	getConfirmedCycleCount,
	getCycle,
	getCycleForDate,
	getProgrammeYearsElapsed,
	getCycleLabel,
	getCycleStartMonth,
	getMonthLabel,
	getMonthName,
	getMonthOrder,
	getPerekSource,
	getYearLabel,
	nextMonth,
	prevMonth,
	resolveCalendarDay,
} from "../../../src/data/learning-schedule";
import catalog from "../../../src/data/db/client-catalog.generated.json";
import { cycles } from "../../../src/data/db/cycles";
import {
	HebrewDate,
	parseNumericalDateToHebcalDate,
} from "../../../src/util/hebdates-util";

const day = (dateNumber: number) =>
	resolveCalendarDay(parseNumericalDateToHebcalDate(dateNumber));

describe("getConfirmedCycleCount", () => {
	it("returns the number of cycles in cycles.json", () => {
		expect(getConfirmedCycleCount()).toBe(10);
	});
});

describe("getCycle", () => {
	it.each(
		cycles.map((start, index) => ({
			number: index + 1,
			start,
		})),
	)("returns confirmed cycle $number with its exact range", ({ number, start }) => {
		const cycle = getCycle(number);
		expect(cycle.projected).toBe(false);
		expect(cycle.start.deltaDays(parseNumericalDateToHebcalDate(start))).toBe(0);
		expect(cycle.end.deltaDays(cycle.start)).toBe(CYCLE_DAYS - 1);
	});

	it("projects cycle 11 exactly 1302 days after cycle 10", () => {
		const cycle10 = getCycle(10);
		const cycle11 = getCycle(11);
		expect(cycle11.projected).toBe(true);
		expect(cycle11.start.deltaDays(cycle10.start)).toBe(CYCLE_SPAN_DAYS);
		expect(cycle11.end.deltaDays(cycle11.start)).toBe(CYCLE_DAYS - 1);
	});

	it("projects consecutive cycles on the same cadence", () => {
		const cycle11 = getCycle(11);
		const cycle13 = getCycle(13);
		expect(cycle13.start.deltaDays(cycle11.start)).toBe(2 * CYCLE_SPAN_DAYS);
	});

	it("throws for non-positive cycle numbers", () => {
		expect(() => getCycle(0)).toThrow();
	});
});

describe("resolveCalendarDay", () => {
	describe("confirmed cycles", () => {
		it.each(
			cycles.map((start, index) => ({ number: index + 1, start })),
		)("assigns perek 1 to the first day of cycle $number", ({ number, start }) => {
			const result = day(start);
			expect(result).toMatchObject({
				status: "study",
				perekId: 1,
				cycle: number,
			});
			expect(result.projected).not.toBe(true);
		});

		it.each(
			catalog.schedule[928].date.map((end, index) => ({
				number: index + 1,
				end,
			})),
		)("assigns perek 929 to the last day of cycle $number", ({ number, end }) => {
			const result = day(end);
			expect(result).toMatchObject({
				status: "study",
				perekId: 929,
				cycle: number,
			});
		});

		it("assigns the exact scheduled perek to a mid-cycle date", () => {
			// שמואל ב ה (perek 268) of cycle 4 is scheduled on כח כסלו תשפ"ו.
			const result = day(57861226);
			expect(result).toMatchObject({ status: "study", perekId: 268, cycle: 4 });
		});

		it("marks Fridays as review of the whole studied week in confirmed cycles", () => {
			// Cycle 4 starts on ז אלול תשפ"ה (Sunday). Its first Friday
			// reviews all five perakim studied Sunday–Thursday, not only
			// Thursday's perek (#2365).
			const thursday = day(57851211);
			const friday = day(57851212);
			expect(thursday.status).toBe("study");
			expect(friday.status).toBe("review");
			expect(friday.perekId).toBe(thursday.perekId);
			expect(friday.reviewPerekIds).toEqual([1, 2, 3, 4, 5]);
		});

		it("marks Saturdays as review of the same week where the schedule has none", () => {
			const thursday = day(57851211);
			const saturday = day(57851213);
			expect(saturday.status).toBe("review");
			expect(saturday.perekId).toBe(thursday.perekId);
			expect(saturday.reviewPerekIds).toEqual([1, 2, 3, 4, 5]);
		});
	});

	describe("cycle 9 schedule anomalies", () => {
		it("keeps a scheduled Saturday as a study day, not a review day", () => {
			const saturday = catalog.schedule
				.map(({ perekId, date }) => ({ perekId, date: date[8] }))
				.find(
					({ date }) =>
						parseNumericalDateToHebcalDate(date).getDay() === 6,
				);
			expect(saturday).toBeDefined();
			if (saturday === undefined) {
				throw new Error("fixture is missing a scheduled Saturday in cycle 9");
			}
			const result = day(saturday.date);
			expect(result).toMatchObject({
				status: "study",
				perekId: saturday.perekId,
				cycle: 9,
			});
		});

		it("marks the multi-day gap before perek 896 as review of perek 895", () => {
			expect(day(58070229)).toMatchObject({ status: "study", perekId: 895 });
			expect(day(58070303)).toMatchObject({ status: "study", perekId: 896 });
			// Every skipped day inside the cycle reviews perek 895.
			for (const skipped of [58070230, 58070301, 58070302]) {
				const result = day(skipped);
				expect(result).toMatchObject({ status: "review", perekId: 895 });
			}
		});
	});

	describe("cycle boundaries", () => {
		it("leaves the three inter-cycle days unscheduled", () => {
			const cycle1End = parseNumericalDateToHebcalDate(57781028);
			for (const offset of [1, 2, 3]) {
				const result = resolveCalendarDay(cycle1End.add(offset));
				expect(result.status).toBe("none");
				expect(result.perekId).toBeUndefined();
			}
		});

		it("starts cycle 2 the day after the gap", () => {
			expect(day(57781103)).toMatchObject({
				status: "study",
				perekId: 1,
				cycle: 2,
			});
		});

		it("leaves dates before the program unscheduled", () => {
			const beforeStart = day(57750328);
			expect(beforeStart.status).toBe("none");
			expect(beforeStart.perekId).toBeUndefined();
			expect(day(50000101).status).toBe("none");
		});
	});

	describe("projected cycles", () => {
		it("assigns perek 1 to the first projected cycle day", () => {
			const cycle11 = getCycle(11);
			const result = resolveCalendarDay(cycle11.start);
			expect(result).toMatchObject({
				status: "study",
				perekId: 1,
				cycle: 11,
				projected: true,
			});
		});

		it("assigns sequential perakim on projected study days", () => {
			const cycle11 = getCycle(11);
			expect(resolveCalendarDay(cycle11.start.add(1))).toMatchObject({
				status: "study",
				perekId: 2,
			});
		});

		it("marks projected Fridays and Saturdays as review of the studied week", () => {
			const cycle11 = getCycle(11);
			// Cycle starts on Sunday: offsets 5/6 are Friday/Saturday of week 1.
			const thursdayPerek = resolveCalendarDay(cycle11.start.add(4)).perekId;
			expect(resolveCalendarDay(cycle11.start.add(5))).toMatchObject({
				status: "review",
				perekId: thursdayPerek,
				reviewPerekIds: [1, 2, 3, 4, 5],
			});
			expect(resolveCalendarDay(cycle11.start.add(6))).toMatchObject({
				status: "review",
				perekId: thursdayPerek,
				reviewPerekIds: [1, 2, 3, 4, 5],
			});
		});

		it("leaves projected inter-cycle gaps unscheduled", () => {
			const cycle11 = getCycle(11);
			const gapDay = resolveCalendarDay(cycle11.start.add(CYCLE_DAYS));
			expect(gapDay.status).toBe("none");
			expect(gapDay.perekId).toBeUndefined();
		});
	});
});

describe("getCycleForDate", () => {
	it("returns the owning confirmed cycle", () => {
		const cycle = getCycleForDate(parseNumericalDateToHebcalDate(57861226));
		expect(cycle).toMatchObject({ number: 4, projected: false });
	});

	it("returns null in an inter-cycle gap", () => {
		const gap = parseNumericalDateToHebcalDate(57781028).add(1);
		expect(getCycleForDate(gap)).toBeNull();
	});

	it("returns null before the program", () => {
		expect(
			getCycleForDate(parseNumericalDateToHebcalDate(57750328)),
		).toBeNull();
	});

	it("returns a projected cycle beyond confirmed data", () => {
		const cycle11 = getCycle(11);
		const cycle = getCycleForDate(cycle11.start.add(10));
		expect(cycle).toMatchObject({ number: 11, projected: true });
	});

	it("walks past whole projected cycles to find a later one", () => {
		const cycle13 = getCycle(13);
		const cycle = getCycleForDate(cycle13.start.add(10));
		expect(cycle).toMatchObject({ number: 13, projected: true });
	});

	it("returns null in a projected inter-cycle gap", () => {
		const cycle11 = getCycle(11);
		// The day after cycle 11 ends is inside the 3-day gap before cycle 12.
		expect(getCycleForDate(cycle11.end.add(1))).toBeNull();
		expect(getCycleForDate(cycle11.end.add(3))).toBeNull();
		expect(getCycleForDate(cycle11.end.add(4))).toMatchObject({
			number: 12,
			projected: true,
		});
	});
});

describe("getMonthOrder", () => {
	it("returns months 1-12 in a regular year", () => {
		expect(getMonthOrder(5785)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
	});

	it("inserts Adar I/II after Shevat in a leap year", () => {
		expect(getMonthOrder(5784)).toEqual([
			1, 2, 3, 4, 5, 13, 14, 7, 8, 9, 10, 11, 12,
		]);
	});
});

describe("nextMonth / prevMonth", () => {
	it("moves Shevat to Adar I in a leap year", () => {
		expect(nextMonth({ year: 5784, month: 5 })).toEqual({
			year: 5784,
			month: 13,
		});
		expect(prevMonth({ year: 5784, month: 13 })).toEqual({
			year: 5784,
			month: 5,
		});
	});

	it("moves Adar II to Nisan in a leap year", () => {
		expect(nextMonth({ year: 5784, month: 14 })).toEqual({
			year: 5784,
			month: 7,
		});
	});

	it("crosses the year boundary at Elul and Tishrei", () => {
		expect(nextMonth({ year: 5784, month: 12 })).toEqual({
			year: 5785,
			month: 1,
		});
		expect(prevMonth({ year: 5785, month: 1 })).toEqual({
			year: 5784,
			month: 12,
		});
	});

	it("throws for a month that does not exist in the year", () => {
		expect(() => nextMonth({ year: 5785, month: 13 })).toThrow();
		expect(() => prevMonth({ year: 5785, month: 14 })).toThrow();
	});
});

describe("compareMonths", () => {
	it("orders months within and across years", () => {
		expect(
			compareMonths({ year: 5784, month: 13 }, { year: 5784, month: 14 }),
		).toBeLessThan(0);
		expect(
			compareMonths({ year: 5784, month: 14 }, { year: 5784, month: 7 }),
		).toBeLessThan(0);
		expect(
			compareMonths({ year: 5784, month: 12 }, { year: 5785, month: 1 }),
		).toBeLessThan(0);
		expect(
			compareMonths({ year: 5785, month: 6 }, { year: 5785, month: 6 }),
		).toBe(0);
	});
});

describe("buildMonth", () => {
	it("builds Kislev 5775 with cycle 1 starting on כט כסלו", () => {
		const cells = buildMonth(5775, 3);
		const days = cells.flatMap((cell) => (cell.day ? [cell.day] : []));
		expect(days[0].dateNumber).toBe(57750301);
		// 1 Kislev 5775 was a Sunday, so there are no leading blanks.
		expect(cells[0].day).toBeDefined();
		expect(days.length).toBeGreaterThanOrEqual(29);
		expect(days.length).toBeLessThanOrEqual(30);
		for (const cell of days) {
			expect(cell.date.year).toBe(5775);
			expect(cell.date.getUniformMonth()).toBe(3);
		}
		const cycleStart = days.find((cell) => cell.dateNumber === 57750329);
		expect(cycleStart).toMatchObject({
			status: "study",
			perekId: 1,
			cycle: 1,
		});
	});

	it("pads leading blanks by the weekday of the first of the month", () => {
		// 1 Cheshvan 5775 was a Saturday -> six blanks (Sunday-Friday).
		const cells = buildMonth(5775, 2);
		for (const index of [0, 1, 2, 3, 4, 5]) {
			expect(cells[index].day).toBeUndefined();
		}
		expect(cells[6].day?.dateNumber).toBe(57750201);
	});

	it("builds Adar I and Adar II in a leap year", () => {
		for (const month of [13, 14]) {
			const days = buildMonth(5784, month).flatMap((cell) =>
				cell.day ? [cell.day] : [],
			);
			expect(days.length).toBeGreaterThanOrEqual(29);
			for (const cell of days) {
				expect(cell.date.getUniformMonth()).toBe(month);
			}
		}
	});
});

describe("labels", () => {
	it("formats the year in Hebrew letters with ה' prefix", () => {
		expect(getYearLabel(5786)).toBe("ה'תשפ\"ו");
	});

	it("omits the ה' prefix for years below 5000", () => {
		expect(getYearLabel(4888)).toBe(toLetters(4888, { addQuotes: true }));
		expect(getYearLabel(4888)).not.toContain("ה'");
	});

	it("returns distinct names for Adar I and Adar II", () => {
		const adar1 = getMonthName(5784, 13);
		const adar2 = getMonthName(5784, 14);
		expect(adar1).toContain("אדר");
		expect(adar2).toContain("אדר");
		expect(adar1).not.toBe(adar2);
	});

	it("formats a month label as '<month> <year>'", () => {
		expect(getMonthLabel({ year: 5786, month: 3 })).toBe("כסלו ה'תשפ\"ו");
	});

	it("returns the cycle start month", () => {
		expect(getCycleStartMonth(getCycle(4))).toEqual({
			year: 5785,
			month: 12,
		});
	});

	it("marks projected cycles in the cycle label", () => {
		expect(getCycleLabel(getCycle(4))).toContain("מחזור 4:");
		expect(getCycleLabel(getCycle(4))).not.toContain("משוער");
		expect(getCycleLabel(getCycle(11))).toContain("מחזור 11 (משוער):");
	});
});

describe("getProgrammeYearsElapsed", () => {
	// The program's first study day is 29 Kislev 5775 (cycles[0]).
	const hdate = (year: number, monthCode: string, day: number) =>
		HebrewDate.fromHebrewComponents(year, monthCode, day);

	it("returns 0 before the program and during its first year", () => {
		expect(getProgrammeYearsElapsed(hdate(5774, "M12", 20))).toBe(0);
		expect(getProgrammeYearsElapsed(hdate(5775, "M01", 15))).toBe(0);
		// Same Hebrew year as the start, a month after it — still no full year.
		expect(getProgrammeYearsElapsed(hdate(5775, "M04", 29))).toBe(0);
	});

	it("returns 0 the day before the first anniversary", () => {
		expect(getProgrammeYearsElapsed(hdate(5776, "M03", 28))).toBe(0);
	});

	it("turns over exactly on the Hebrew anniversary", () => {
		expect(getProgrammeYearsElapsed(hdate(5776, "M03", 29))).toBe(1);
		expect(getProgrammeYearsElapsed(hdate(5776, "M03", 30))).toBe(1);
		expect(getProgrammeYearsElapsed(hdate(5776, "M04", 1))).toBe(1);
	});

	it("counts completed years, never rounding up before the anniversary", () => {
		// Tishrei 5787 precedes 29 Kislev 5787 → 11 completed years, not 12.
		expect(getProgrammeYearsElapsed(hdate(5787, "M01", 10))).toBe(11);
		expect(getProgrammeYearsElapsed(hdate(5787, "M03", 29))).toBe(12);
	});

	it("handles leap-year dates on both sides of the anniversary", () => {
		// 5784 is a leap year — Adar I and Adar II dates must still compare
		// correctly against a Kislev anniversary (both follow it), while
		// Cheshvan still precedes it.
		expect(getProgrammeYearsElapsed(hdate(5784, "M02", 20))).toBe(8);
		expect(getProgrammeYearsElapsed(hdate(5784, "M05L", 15))).toBe(9);
		expect(getProgrammeYearsElapsed(hdate(5784, "M06", 1))).toBe(9);
	});
});

describe("getPerekSource", () => {
	it("returns the sefer name and perek in Hebrew letters", () => {
		expect(getPerekSource(1)).toBe("בראשית א");
		const shmuel2 = catalog.volumes.find((v) => v.name === "שמואל ב");
		expect(shmuel2).toBeDefined();
		if (shmuel2 === undefined) {
			throw new Error("catalog is missing שמואל ב");
		}
		expect(getPerekSource(shmuel2.perekFrom + 4)).toBe("שמואל ב ה");
	});
});
