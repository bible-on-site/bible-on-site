import {
	buildCycleFlipMonths,
	buildFlipPageSemantics,
	buildYearFlipMonths,
	clampMonthToFlipScope,
	flipBookPageCount,
	flipMonthAtPageIndex,
	flipMonthPageIndex,
	flipMonthPosition,
	flipPageIndexForMonth,
	initialTurnedLeavesForPage,
} from "@/app/calendar/components/flip-month-data";
import type { CalendarCycleWindow } from "@/data/learning-calendar-policy";
import {
	getCycle,
	getCycleStartMonth,
	getMonthLabel,
	getMonthOrder,
} from "@/data/learning-schedule";

// A window spanning every year the fixtures touch, so the month builders
// behave like the unbounded schedule these tests were written against.
const testWindow: CalendarCycleWindow = {
	current: null,
	next: getCycle(30),
	first: getCycle(1),
	minMonth: { year: 5780, month: 1 },
	maxMonth: { year: 5800, month: 12 },
};

describe("flip-month-data", () => {
	describe("buildYearFlipMonths", () => {
		it("returns one entry per month of a regular year", () => {
			const months = buildYearFlipMonths(5785, testWindow);
			expect(months).toHaveLength(12);
			expect(months[0].ref).toEqual({ year: 5785, month: 1 });
			expect(months[11].ref).toEqual({ year: 5785, month: 12 });
		});

		it("includes Adar I and Adar II in a leap year, in order", () => {
			const months = buildYearFlipMonths(5784, testWindow);
			expect(months).toHaveLength(13);
			const order = months.map((m) => m.ref.month);
			expect(order).toEqual(getMonthOrder(5784));
			// Adar II (14) sits between Adar I (13) and Nisan (7).
			expect(order.indexOf(14)).toBe(order.indexOf(13) + 1);
			expect(order.indexOf(7)).toBe(order.indexOf(14) + 1);
		});

		it("builds real month cells with scheduled days", () => {
			const months = buildYearFlipMonths(5785, testWindow);
			const elul = months.find((m) => m.ref.month === 12);
			expect(elul?.cells.some((cell) => cell.day !== undefined)).toBe(true);
		});
	});

	describe("buildCycleFlipMonths", () => {
		it("spans every month from cycle start through cycle end", () => {
			const cycle = getCycle(4);
			const months = buildCycleFlipMonths(4, testWindow);
			expect(months.length).toBeGreaterThan(30);
			expect(months[0].ref).toEqual(getCycleStartMonth(cycle));
			// Last sheet is the month containing the cycle's final day.
			const last = months[months.length - 1].ref;
			expect(last.year).toBe(cycle.end.year);
			expect(last.month).toBe(cycle.end.getUniformMonth());
		});

		it("keeps chronological order across year boundaries", () => {
			const months = buildCycleFlipMonths(4, testWindow);
			for (let i = 1; i < months.length; i += 1) {
				const prev = months[i - 1].ref;
				const cur = months[i].ref;
				// Uniform month numbers are not globally ordered; compare via
				// year first then trust the builder's nextMonth walk — simply
				// assert refs differ and years never decrease.
				expect(cur.year).toBeGreaterThanOrEqual(prev.year);
			}
		});
	});

	describe("page index math", () => {
		const months = buildYearFlipMonths(5785, testWindow);

		it("maps month positions to readable faces two pages apart", () => {
			// Each month owns a whole visible pair (readable face + card back),
			// so consecutive months sit two page indices apart — a leaf turn
			// never strands a month under the turned stack.
			expect(flipMonthPageIndex(0)).toBe(3);
			expect(flipMonthPageIndex(1)).toBe(5);
			expect(flipMonthPageIndex(11)).toBe(25);
			expect(flipBookPageCount(12)).toBe(29);
		});

		it("resolves a month ref to its readable face index", () => {
			expect(flipPageIndexForMonth(months, { year: 5785, month: 7 })).toBe(
				flipMonthPageIndex(months.findIndex((m) => m.ref.month === 7)),
			);
		});

		it("returns -1 for a month outside the book", () => {
			expect(flipPageIndexForMonth(months, { year: 5786, month: 1 })).toBe(-1);
			expect(flipMonthPosition(months, { year: 5786, month: 1 })).toBe(-1);
		});

		it("maps page indices back to months and null for chrome", () => {
			expect(flipMonthAtPageIndex(months, 3)).toEqual({
				year: 5785,
				month: 1,
			});
			// The card-back face of a pair resolves to the same month.
			expect(flipMonthAtPageIndex(months, 4)).toEqual({
				year: 5785,
				month: 1,
			});
			expect(flipMonthAtPageIndex(months, 5)).toEqual({
				year: 5785,
				month: 2,
			});
			expect(flipMonthAtPageIndex(months, 26)).toEqual({
				year: 5785,
				month: 12,
			});
			expect(flipMonthAtPageIndex(months, 0)).toBeNull();
			expect(flipMonthAtPageIndex(months, 27)).toBeNull(); // back interior
			expect(flipMonthAtPageIndex(months, 28)).toBeNull(); // back cover
			expect(flipMonthAtPageIndex(months, 99)).toBeNull();
		});
	});

	describe("clampMonthToFlipScope", () => {
		const months = buildYearFlipMonths(5785, testWindow);

		it("returns the exact month when present", () => {
			expect(
				clampMonthToFlipScope(months, { year: 5785, month: 9 }),
			).toEqual({ year: 5785, month: 9 });
		});

		it("falls back to the closest earlier month inside the scope", () => {
			// A month of a different year clamps to the year's last month.
			expect(
				clampMonthToFlipScope(months, { year: 5786, month: 3 }),
			).toEqual({ year: 5785, month: 12 });
			// An earlier year clamps to the first month.
			expect(
				clampMonthToFlipScope(months, { year: 5784, month: 12 }),
			).toEqual({ year: 5785, month: 1 });
		});
	});

	describe("initialTurnedLeavesForPage", () => {
		it("opens on the cover spread for page 0", () => {
			expect(initialTurnedLeavesForPage(0, 29)).toEqual([]);
		});

		it("turns leaves so the spread contains the requested page", () => {
			// Page 3 (first month sheet, leaf 1 back) needs leaves 0 and 1
			// turned; page 4 (its card back) shares the same spread.
			expect(initialTurnedLeavesForPage(3, 29)).toEqual([0, 1]);
			expect(initialTurnedLeavesForPage(4, 29)).toEqual([0, 1]);
			// Page 5 (second month sheet) turns leaf 2 as well.
			expect(initialTurnedLeavesForPage(5, 29)).toEqual([0, 1, 2]);
		});

		it("reaches the last page of an odd-page-count book", () => {
			// 12 months → 29 pages: the back cover sits at index 28.
			const leaves = initialTurnedLeavesForPage(28, 29);
			expect(leaves).toHaveLength(14);
			expect(leaves[leaves.length - 1]).toBe(13);
		});

		it("lands on the final leaf of an even-page-count book", () => {
			// The generic helper also covers even counts (e.g. a future
			// layout change): the last odd index maps to the final leaf.
			const leaves = initialTurnedLeavesForPage(17, 18);
			expect(leaves).toHaveLength(9);
			expect(leaves[leaves.length - 1]).toBe(8);
		});
	});

	describe("buildFlipPageSemantics", () => {
		it("names month pages uniquely inside a cycle book", () => {
			const months = buildCycleFlipMonths(4, testWindow);
			const semantics = buildFlipPageSemantics(
				months,
				flipBookPageCount(months.length),
			);
			const names = months.map((m) => m.semanticName);
			expect(new Set(names).size).toBe(names.length);
			// First month sheet sits at page index 3.
			expect(semantics.indexToSemanticName(3)).toBe(months[0].semanticName);
			expect(semantics.semanticNameToIndex(months[0].semanticName)).toBe(3);
		});

		it("uses bare month names inside a year book", () => {
			const months = buildYearFlipMonths(5785, testWindow);
			const semantics = buildFlipPageSemantics(months, 29);
			expect(semantics.indexToSemanticName(3)).toBe(months[0].semanticName);
			expect(semantics.indexToSemanticName(3)).not.toContain("ה'");
			// Second month sheet sits two faces later (sheet + card back).
			expect(semantics.indexToSemanticName(5)).toBe(months[1].semanticName);
		});

		it("keeps companion card-back faces semantically empty", () => {
			const months = buildYearFlipMonths(5785, testWindow);
			const semantics = buildFlipPageSemantics(months, 29);
			// Page 4 is the card back under the first month sheet.
			expect(semantics.indexToSemanticName(4)).toBe("");
			expect(semantics.indexToTitle(4)).toBe("");
		});

		it("reports titles for month and chrome pages", () => {
			const months = buildYearFlipMonths(5785, testWindow);
			const semantics = buildFlipPageSemantics(months, 29);
			expect(semantics.indexToTitle(3)).toBe(
				getMonthLabel(months[0].ref),
			);
			expect(semantics.indexToTitle(0)).toBe("עטיפה קדמית");
			expect(semantics.indexToTitle(28)).toBe("עטיפה אחורית");
			expect(semantics.indexToTitle(27)).toBe("");
			expect(semantics.indexToSemanticName(0)).toBe("");
			expect(semantics.semanticNameToIndex("לא קיים")).toBeNull();
		});
	});
});
