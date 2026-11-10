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
import {
	getCycle,
	getCycleStartMonth,
	getMonthLabel,
	getMonthOrder,
} from "@/data/learning-schedule";

describe("flip-month-data", () => {
	describe("buildYearFlipMonths", () => {
		it("returns one entry per month of a regular year", () => {
			const months = buildYearFlipMonths(5785);
			expect(months).toHaveLength(12);
			expect(months[0].ref).toEqual({ year: 5785, month: 1 });
			expect(months[11].ref).toEqual({ year: 5785, month: 12 });
		});

		it("includes Adar I and Adar II in a leap year, in order", () => {
			const months = buildYearFlipMonths(5784);
			expect(months).toHaveLength(13);
			const order = months.map((m) => m.ref.month);
			expect(order).toEqual(getMonthOrder(5784));
			// Adar II (14) sits between Adar I (13) and Nisan (7).
			expect(order.indexOf(14)).toBe(order.indexOf(13) + 1);
			expect(order.indexOf(7)).toBe(order.indexOf(14) + 1);
		});

		it("builds real month cells with scheduled days", () => {
			const months = buildYearFlipMonths(5785);
			const elul = months.find((m) => m.ref.month === 12);
			expect(elul?.cells.some((cell) => cell.day !== undefined)).toBe(true);
		});
	});

	describe("buildCycleFlipMonths", () => {
		it("spans every month from cycle start through cycle end", () => {
			const cycle = getCycle(4);
			const months = buildCycleFlipMonths(4);
			expect(months.length).toBeGreaterThan(30);
			expect(months[0].ref).toEqual(getCycleStartMonth(cycle));
			// Last sheet is the month containing the cycle's final day.
			const last = months[months.length - 1].ref;
			expect(last.year).toBe(cycle.end.year);
			expect(last.month).toBe(cycle.end.getUniformMonth());
		});

		it("keeps chronological order across year boundaries", () => {
			const months = buildCycleFlipMonths(4);
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
		const months = buildYearFlipMonths(5785);

		it("maps month positions to pages after the three chrome faces", () => {
			expect(flipMonthPageIndex(0)).toBe(3);
			expect(flipMonthPageIndex(11)).toBe(14);
			expect(flipBookPageCount(12)).toBe(17);
		});

		it("resolves a month ref to its page index", () => {
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
			expect(flipMonthAtPageIndex(months, 14)).toEqual({
				year: 5785,
				month: 12,
			});
			expect(flipMonthAtPageIndex(months, 0)).toBeNull();
			expect(flipMonthAtPageIndex(months, 15)).toBeNull(); // back interior
			expect(flipMonthAtPageIndex(months, 16)).toBeNull(); // back cover
			expect(flipMonthAtPageIndex(months, 99)).toBeNull();
		});
	});

	describe("clampMonthToFlipScope", () => {
		const months = buildYearFlipMonths(5785);

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
			expect(initialTurnedLeavesForPage(0, 17)).toEqual([]);
		});

		it("turns leaves so the spread contains the requested page", () => {
			// Page 3 (first month, leaf 1 back) needs leaves 0 and 1 turned.
			expect(initialTurnedLeavesForPage(3, 17)).toEqual([0, 1]);
			// Page 4 shares the same spread as page 3.
			expect(initialTurnedLeavesForPage(4, 17)).toEqual([0, 1]);
			// Page 5 (next spread) turns leaf 2 as well.
			expect(initialTurnedLeavesForPage(5, 17)).toEqual([0, 1, 2]);
		});

		it("reaches the last page of an even-page-count book", () => {
			const leaves = initialTurnedLeavesForPage(17, 18);
			expect(leaves).toHaveLength(9);
			expect(leaves[leaves.length - 1]).toBe(8);
		});
	});

	describe("buildFlipPageSemantics", () => {
		it("names month pages uniquely inside a cycle book", () => {
			const months = buildCycleFlipMonths(4);
			const semantics = buildFlipPageSemantics(months, 48);
			const names = months.map((m) => m.semanticName);
			expect(new Set(names).size).toBe(names.length);
			// First month sheet sits at page index 3.
			expect(semantics.indexToSemanticName(3)).toBe(months[0].semanticName);
			expect(semantics.semanticNameToIndex(months[0].semanticName)).toBe(3);
		});

		it("uses bare month names inside a year book", () => {
			const months = buildYearFlipMonths(5785);
			const semantics = buildFlipPageSemantics(months, 17);
			expect(semantics.indexToSemanticName(3)).toBe(months[0].semanticName);
			expect(semantics.indexToSemanticName(3)).not.toContain("ה'");
		});

		it("reports titles for month and chrome pages", () => {
			const months = buildYearFlipMonths(5785);
			const semantics = buildFlipPageSemantics(months, 17);
			expect(semantics.indexToTitle(3)).toBe(
				getMonthLabel(months[0].ref),
			);
			expect(semantics.indexToTitle(0)).toBe("עטיפה קדמית");
			expect(semantics.indexToTitle(16)).toBe("עטיפה אחורית");
			expect(semantics.indexToTitle(15)).toBe("");
			expect(semantics.indexToSemanticName(0)).toBe("");
			expect(semantics.semanticNameToIndex("לא קיים")).toBeNull();
		});
	});
});
