/**
 * Unit tests for the shared range->commentary/article query builders.
 */
import {
	canonicalPasukCount,
	coveringSourceSliceCondition,
	noteSliceCondition,
	slicePerekIds,
	slicePerekOrder,
	slicesForRanges,
} from "../../../../src/lib/reading/queries";

describe("slicesForRanges", () => {
	it("splits a cross-perek range at canonical perek bounds", () => {
		// בראשית א has 31 pesukim, ב has 25.
		const slices = slicesForRanges([
			{
				start: { perekId: 1, pasuk: 30 },
				end: { perekId: 2, pasuk: 4 },
			},
		]);
		expect(slices).toEqual([
			{ perekId: 1, startPasuk: 30, endPasuk: 31, rangeIndex: 0 },
			{ perekId: 2, startPasuk: 1, endPasuk: 4, rangeIndex: 0 },
		]);
	});

	it("preserves order and repeat pesukim across auxiliary ranges", () => {
		const slices = slicesForRanges([
			{ start: { perekId: 100, pasuk: 10 }, end: { perekId: 100, pasuk: 12 } },
			{ start: { perekId: 1, pasuk: 1 }, end: { perekId: 1, pasuk: 3 } },
			{ start: { perekId: 100, pasuk: 12 }, end: { perekId: 100, pasuk: 12 } },
		]);
		expect(slices.map((s) => [s.perekId, s.startPasuk, s.endPasuk])).toEqual([
			[100, 10, 12],
			[1, 1, 3],
			[100, 12, 12],
		]);
	});
});

describe("noteSliceCondition", () => {
	it("emits one parameterized clause per slice", () => {
		const { sql, params } = noteSliceCondition([
			{ perekId: 1, startPasuk: 30, endPasuk: 31, rangeIndex: 0 },
			{ perekId: 2, startPasuk: 1, endPasuk: 4, rangeIndex: 0 },
		]);
		expect(sql).toBe(
			"(n.perek_id = ? AND n.pasuk >= ? AND n.pasuk <= ?) OR " +
				"(n.perek_id = ? AND n.pasuk >= ? AND n.pasuk <= ?)",
		);
		expect(params).toEqual([1, 30, 31, 2, 1, 4]);
	});
});

describe("coveringSourceSliceCondition", () => {
	it("emits the same pasuk bounds on the covering-source alias", () => {
		const { sql, params } = coveringSourceSliceCondition([
			{ perekId: 1, startPasuk: 30, endPasuk: 31, rangeIndex: 0 },
			{ perekId: 2, startPasuk: 1, endPasuk: 4, rangeIndex: 0 },
		]);
		expect(sql).toBe(
			"(cs.perek_id = ? AND cs.pasuk >= ? AND cs.pasuk <= ?) OR " +
				"(cs.perek_id = ? AND cs.pasuk >= ? AND cs.pasuk <= ?)",
		);
		expect(params).toEqual([1, 30, 31, 2, 1, 4]);
	});
});

describe("perek ordering helpers", () => {
	it("deduplicates perek ids in first-appearance order", () => {
		expect(
			slicePerekIds([
				{ perekId: 100, startPasuk: 1, endPasuk: 5, rangeIndex: 0 },
				{ perekId: 1, startPasuk: 1, endPasuk: 3, rangeIndex: 1 },
				{ perekId: 100, startPasuk: 9, endPasuk: 9, rangeIndex: 2 },
			]),
		).toEqual([100, 1]);
	});

	it("ranks perakim by first slice appearance", () => {
		const order = slicePerekOrder([
			{ perekId: 100, startPasuk: 1, endPasuk: 5, rangeIndex: 0 },
			{ perekId: 1, startPasuk: 1, endPasuk: 3, rangeIndex: 1 },
			{ perekId: 100, startPasuk: 9, endPasuk: 9, rangeIndex: 2 },
		]);
		expect(order.get(100)).toBe(0);
		expect(order.get(1)).toBe(1);
	});
});

describe("canonicalPasukCount", () => {
	it("returns the corpus pasuk count of a perek", () => {
		expect(canonicalPasukCount(1)).toBe(31);
	});
});
