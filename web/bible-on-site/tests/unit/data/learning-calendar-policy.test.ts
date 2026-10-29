import {
	buildVisibleCalendarMonth,
	calendarCycleExportOpens,
	canExportCalendarPeriod,
	clampCalendarMonth,
	getCalendarCycleWindow,
	visibleCalendarMonths,
} from "@/data/learning-calendar-policy";
import {
	getCycle,
	getCycleLabel,
	getMonthName,
} from "@/data/learning-schedule";
import {
	hebcalDateToNumber,
	parseNumericalDateToHebcalDate,
} from "@/util/hebdates-util";

const date = parseNumericalDateToHebcalDate;
const today = date(57870217);

describe("learning calendar limits", () => {
	it("normalizes legacy punctuation in displayed Hebrew dates and month names", () => {
		expect(getMonthName(5784, 13)).not.toMatch(/[׳״]/);
		expect(getCycleLabel(getCycle(3))).not.toMatch(/[׳״]/);
	});
	it("shows all past cycles, current and exactly one next cycle", () => {
		const window = getCalendarCycleWindow(today);
		expect(window.current?.number).toBe(4);
		expect(window.next.number).toBe(5);
		expect(window.minMonth).toEqual({ year: 5775, month: 1 });
		expect(window.maxMonth).toEqual({ year: 5793, month: 2 });
	});
	it("handles pre-programme dates, all three gap days and projected cycles", () => {
		expect(getCalendarCycleWindow(getCycle(1).start.add(-1)).next.number).toBe(
			1,
		);
		for (const offset of [1, 2, 3]) {
			const window = getCalendarCycleWindow(getCycle(4).end.add(offset));
			expect(window.current).toBeNull();
			expect(window.next.number).toBe(5);
		}
		expect(getCalendarCycleWindow(getCycle(11).start).next.number).toBe(12);
	});
	it("clamps months and picker choices at both ends", () => {
		const window = getCalendarCycleWindow(today);
		expect(clampCalendarMonth({ year: 5774, month: 1 }, window)).toEqual(
			window.minMonth,
		);
		expect(clampCalendarMonth({ year: 5800, month: 1 }, window)).toEqual(
			window.maxMonth,
		);
		expect(clampCalendarMonth({ year: 5787, month: 1 }, window)).toEqual({
			year: 5787,
			month: 1,
		});
		expect(visibleCalendarMonths(5775, window)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
		expect(visibleCalendarMonths(5793, window)).toEqual([1, 2]);
		expect(visibleCalendarMonths(5794, window)).toEqual([]);
	});
	it("does not leak the cycle after next through the last month's cells", () => {
		const window = getCalendarCycleWindow(today);
		const cells = buildVisibleCalendarMonth(5793, 2, window);
		expect(cells.some((cell) => cell.day?.cycle === 5)).toBe(true);
		const beyond = cells.flatMap((cell) =>
			cell.day && cell.day.date.deltaDays(window.next.end) > 0
				? [cell.day]
				: [],
		);
		expect(beyond.length).toBeGreaterThan(0);
		for (const day of beyond) {
			expect(day.status).toBe("none");
			expect(day.perekId).toBeUndefined();
			expect(day.cycle).toBeUndefined();
		}
		expect(
			buildVisibleCalendarMonth(5775, 3, window).find(
				(cell) => cell.day?.day === 1,
			)?.day?.perekId,
		).toBeUndefined();
	});
	it("opens all of the next cycle at the inclusive Hebrew-year anniversary", () => {
		const opens = calendarCycleExportOpens(getCycle(5));
		expect(hebcalDateToNumber(opens)).toBe(57880709);
		expect(
			canExportCalendarPeriod({ view: "cycle", cycle: 5 }, opens.add(-1)),
		).toBe(false);
		expect(canExportCalendarPeriod({ view: "cycle", cycle: 5 }, opens)).toBe(
			true,
		);
		for (const year of [5790, 5791, 5792]) {
			expect(canExportCalendarPeriod({ view: "year", year }, opens)).toBe(true);
		}
		expect(
			canExportCalendarPeriod({ view: "month", year: 5792, month: 12 }, opens),
		).toBe(true);
	});
	it("handles leap Adar, ordinary Adar and shorter anniversary months", () => {
		for (const [start, expected] of [
			[57841330, 57830629],
			[57841405, 57830605],
			[57850605, 57841405],
			[57830330, 57820330],
		]) {
			const cycle = {
				number: 1,
				start: date(start),
				end: date(start),
				projected: true,
			};
			expect(hebcalDateToNumber(calendarCycleExportOpens(cycle))).toBe(
				expected,
			);
		}
	});
	it("rejects past and farther-future PDFs even if their artifacts exist", () => {
		for (const cycle of [1, 3, 5, 6, 999])
			expect(canExportCalendarPeriod({ view: "cycle", cycle }, today)).toBe(
				false,
			);
		expect(canExportCalendarPeriod({ view: "cycle", cycle: 4 }, today)).toBe(
			true,
		);
		expect(
			canExportCalendarPeriod({ view: "month", year: 5787, month: 2 }, today),
		).toBe(true);
		expect(canExportCalendarPeriod({ view: "year", year: 5787 }, today)).toBe(
			true,
		);
		for (const year of [5774, 5784, 5785, 5789, 5790, 5793, 9999])
			expect(canExportCalendarPeriod({ view: "year", year }, today)).toBe(
				false,
			);
		expect(
			canExportCalendarPeriod({ view: "month", year: 5785, month: 13 }, today),
		).toBe(false);
		expect(
			canExportCalendarPeriod({ view: "month", year: 5789, month: 8 }, today),
		).toBe(false);
		expect(
			canExportCalendarPeriod({ view: "month", year: 5785, month: 12 }, today),
		).toBe(false);
	});
	it("permits a year spanning current/next only after both are eligible", () => {
		const opens = calendarCycleExportOpens(getCycle(5));
		expect(
			canExportCalendarPeriod({ view: "year", year: 5789 }, opens.add(-1)),
		).toBe(false);
		expect(canExportCalendarPeriod({ view: "year", year: 5789 }, opens)).toBe(
			true,
		);
		// The tail of the next cycle's last year belongs to cycle 6.
		expect(canExportCalendarPeriod({ view: "year", year: 5793 }, opens)).toBe(
			false,
		);
	});
	it("handles programme start and the gap without inventing a current cycle", () => {
		const first = getCycle(1);
		expect(
			canExportCalendarPeriod(
				{ view: "year", year: first.start.year },
				first.start,
			),
		).toBe(true);
		expect(
			canExportCalendarPeriod(
				{ view: "year", year: 5775 },
				first.start.add(-800),
			),
		).toBe(false);
		expect(
			canExportCalendarPeriod(
				{ view: "cycle", cycle: 5 },
				getCycle(4).end.add(1),
			),
		).toBe(true);
	});
});
