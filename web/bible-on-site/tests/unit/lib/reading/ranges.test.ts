/**
 * Unit tests for the shared reading-unit contract range math.
 */
import type {
	ReadingUnit,
	ScriptureRange,
} from "../../../../src/lib/reading/contract";
import {
	compareCoordinates,
	rangeContainsCoordinate,
	rangeContainsPasuk,
	rangeIsExactlyOnePerek,
	rangePerekSlices,
	rangesPerekSlices,
	unitContainsPasuk,
	unitEquivalentPerekId,
	unitPerekIds,
	unitPerekSlices,
} from "../../../../src/lib/reading/ranges";

const pasukCounts: Record<number, number> = {
	1: 31,
	2: 25,
	3: 22,
	4: 10,
	5: 5,
	100: 20,
	101: 30,
};
const pasukCount = (perekId: number): number => pasukCounts[perekId] ?? 20;

describe("compareCoordinates", () => {
	it("orders by perek, then pasuk, then segment index", () => {
		expect(
			compareCoordinates({ perekId: 1, pasuk: 2 }, { perekId: 1, pasuk: 3 }),
		).toBeLessThan(0);
		expect(
			compareCoordinates(
				{ perekId: 1, pasuk: 2, segmentIndex: 4 },
				{ perekId: 1, pasuk: 2, segmentIndex: 9 },
			),
		).toBeLessThan(0);
		expect(
			compareCoordinates({ perekId: 2, pasuk: 1 }, { perekId: 1, pasuk: 9 }),
		).toBeGreaterThan(0);
	});

	it("treats a missing segmentIndex as the requested pasuk edge", () => {
		// As a start edge, a bare pasuk sits before any segment.
		expect(
			compareCoordinates(
				{ perekId: 1, pasuk: 5 },
				{ perekId: 1, pasuk: 5, segmentIndex: 0 },
				"start",
			),
		).toBeLessThan(0);
		// As an end edge, it sits after every segment.
		expect(
			compareCoordinates(
				{ perekId: 1, pasuk: 5 },
				{ perekId: 1, pasuk: 5, segmentIndex: 40 },
				"end",
			),
		).toBeGreaterThan(0);
	});
});

describe("rangePerekSlices", () => {
	it("returns one full-perek slice for a same-perek range", () => {
		const slices = rangePerekSlices(
			{
				start: { perekId: 3, pasuk: 4 },
				end: { perekId: 3, pasuk: 8 },
			},
			pasukCount,
		);
		expect(slices).toEqual([
			{ perekId: 3, startPasuk: 4, endPasuk: 8, rangeIndex: 0 },
		]);
	});

	it("splits a cross-perek range into clipped per-perek slices", () => {
		const slices = rangePerekSlices(
			{
				start: { perekId: 3, pasuk: 20 },
				end: { perekId: 5, pasuk: 3 },
			},
			pasukCount,
		);
		expect(slices).toEqual([
			{ perekId: 3, startPasuk: 20, endPasuk: 22, rangeIndex: 0 },
			{ perekId: 4, startPasuk: 1, endPasuk: 10, rangeIndex: 0 },
			{ perekId: 5, startPasuk: 1, endPasuk: 3, rangeIndex: 0 },
		]);
	});

	it("carries intra-pasuk segment bounds on the boundary slices", () => {
		const slices = rangePerekSlices(
			{
				start: { perekId: 3, pasuk: 7, segmentIndex: 15 },
				end: { perekId: 4, pasuk: 2, segmentIndex: 9 },
			},
			pasukCount,
		);
		expect(slices).toEqual([
			{
				perekId: 3,
				startPasuk: 7,
				endPasuk: 22,
				rangeIndex: 0,
				startSegmentIndex: 15,
			},
			{
				perekId: 4,
				startPasuk: 1,
				endPasuk: 2,
				rangeIndex: 0,
				endSegmentIndex: 9,
			},
		]);
	});

	it("clips range ends that exceed the canonical pasuk count", () => {
		const slices = rangePerekSlices(
			{
				start: { perekId: 4, pasuk: 8 },
				end: { perekId: 4, pasuk: 99 },
			},
			pasukCount,
		);
		expect(slices[0].endPasuk).toBe(10);
	});
});

describe("rangesPerekSlices", () => {
	it("preserves range order for out-of-order auxiliary ranges", () => {
		const slices = rangesPerekSlices(
			[
				{
					start: { perekId: 100, pasuk: 10 },
					end: { perekId: 100, pasuk: 20 },
				},
				{
					start: { perekId: 3, pasuk: 1 },
					end: { perekId: 3, pasuk: 5 },
				},
				{
					start: { perekId: 100, pasuk: 20 },
					end: { perekId: 100, pasuk: 20 },
				},
			],
			pasukCount,
		);
		expect(slices.map((s) => [s.perekId, s.rangeIndex])).toEqual([
			[100, 0],
			[3, 1],
			[100, 2],
		]);
	});
});

describe("rangeContainsPasuk", () => {
	const range: ScriptureRange = {
		start: { perekId: 3, pasuk: 7, segmentIndex: 15 },
		end: { perekId: 4, pasuk: 2, segmentIndex: 9 },
	};

	it("includes whole interior pesukim and both boundary pesukim", () => {
		expect(rangeContainsPasuk(range, 3, 7)).toBe(true);
		expect(rangeContainsPasuk(range, 3, 10)).toBe(true);
		expect(rangeContainsPasuk(range, 4, 1)).toBe(true);
		expect(rangeContainsPasuk(range, 4, 2)).toBe(true);
	});

	it("excludes pesukim outside the bounds", () => {
		expect(rangeContainsPasuk(range, 3, 6)).toBe(false);
		expect(rangeContainsPasuk(range, 4, 3)).toBe(false);
		expect(rangeContainsPasuk(range, 2, 9)).toBe(false);
	});
});

describe("rangeContainsCoordinate", () => {
	const range = {
		start: { perekId: 2, pasuk: 3, segmentIndex: 2 },
		end: { perekId: 3, pasuk: 4, segmentIndex: 1 },
	};

	it("defaults a missing coordinate segment to the pasuk start", () => {
		// A bare position on the boundary pasuk is inside when the
		// range opens at segment 0 of that pasuk.
		expect(
			rangeContainsCoordinate(
				{ start: { perekId: 2, pasuk: 3 }, end: { perekId: 2, pasuk: 6 } },
				{ perekId: 2, pasuk: 3 },
			),
		).toBe(true);
		// …but falls before a mid-pasuk start bound.
		expect(rangeContainsCoordinate(range, { perekId: 2, pasuk: 3 })).toBe(
			false,
		);
	});

	it("treats a missing end bound as the whole pasuk", () => {
		// Range end carries no segmentIndex -> the coordinate inside
		// the end pasuk counts as inside regardless of its segment.
		expect(
			rangeContainsCoordinate(
				{ start: { perekId: 2, pasuk: 3 }, end: { perekId: 3, pasuk: 4 } },
				{ perekId: 3, pasuk: 4, segmentIndex: 9 },
			),
		).toBe(true);
		expect(
			rangeContainsCoordinate(range, {
				perekId: 3,
				pasuk: 4,
				segmentIndex: 0,
			}),
		).toBe(true);
		expect(
			rangeContainsCoordinate(range, {
				perekId: 3,
				pasuk: 4,
				segmentIndex: 2,
			}),
		).toBe(false);
	});

	it("compares perek ids before pesukim", () => {
		expect(rangeContainsCoordinate(range, { perekId: 1, pasuk: 9 })).toBe(
			false,
		);
		expect(rangeContainsCoordinate(range, { perekId: 4, pasuk: 1 })).toBe(
			false,
		);
		expect(rangeContainsCoordinate(range, { perekId: 3, pasuk: 1 })).toBe(true);
	});
});

function makeUnit(overrides: Partial<ReadingUnit>): ReadingUnit {
	return {
		division: "masora",
		unitId: 7,
		slug: "7",
		seferName: "בראשית",
		order: 3,
		heading: "x",
		ranges: [
			{
				start: { perekId: 3, pasuk: 4 },
				end: { perekId: 3, pasuk: 8 },
			},
		],
		...overrides,
	};
}

describe("unit helpers", () => {
	it("unitPerekSlices covers primary plus auxiliary ranges in order", () => {
		const unit = makeUnit({
			auxiliaryReadings: [
				{
					id: "haftara",
					label: "הפטרה",
					ranges: [
						{
							start: { perekId: 100, pasuk: 1 },
							end: { perekId: 100, pasuk: 5 },
						},
					],
				},
			],
		});
		expect(unitPerekSlices(unit, pasukCount).map((s) => s.perekId)).toEqual([
			3, 100,
		]);
		expect(unitPerekIds(unit, pasukCount)).toEqual([3, 100]);
	});

	it("unitContainsPasuk consults primary ranges only", () => {
		const unit = makeUnit({
			auxiliaryReadings: [
				{
					id: "haftara",
					label: "הפטרה",
					ranges: [
						{
							start: { perekId: 100, pasuk: 1 },
							end: { perekId: 100, pasuk: 5 },
						},
					],
				},
			],
		});
		expect(unitContainsPasuk(unit, 3, 6)).toBe(true);
		expect(unitContainsPasuk(unit, 100, 3)).toBe(false);
	});
});

describe("canonical consolidation policy helpers", () => {
	it("detects a range covering exactly one perek", () => {
		expect(
			rangeIsExactlyOnePerek(
				{
					start: { perekId: 5, pasuk: 1 },
					end: { perekId: 5, pasuk: 5 },
				},
				pasukCount,
			),
		).toBe(true);
		expect(
			rangeIsExactlyOnePerek(
				{
					start: { perekId: 5, pasuk: 1 },
					end: { perekId: 5, pasuk: 4 },
				},
				pasukCount,
			),
		).toBe(false);
		expect(
			rangeIsExactlyOnePerek(
				{
					start: { perekId: 5, pasuk: 1, segmentIndex: 2 },
					end: { perekId: 5, pasuk: 5 },
				},
				pasukCount,
			),
		).toBe(false);
	});

	it("unitEquivalentPerekId returns the perek only for exact single-perek units", () => {
		expect(
			unitEquivalentPerekId(
				makeUnit({
					ranges: [
						{
							start: { perekId: 5, pasuk: 1 },
							end: { perekId: 5, pasuk: 5 },
						},
					],
				}),
				pasukCount,
			),
		).toBe(5);
		expect(
			unitEquivalentPerekId(
				makeUnit({
					ranges: [
						{
							start: { perekId: 5, pasuk: 2 },
							end: { perekId: 5, pasuk: 5 },
						},
					],
				}),
				pasukCount,
			),
		).toBeNull();
	});

	it("unitEquivalentPerekId rejects whole-perek units carrying auxiliary readings", () => {
		// A parasha exactly one perek long plus a Haftarah must not
		// collapse into the bare perek canonical.
		const unit = makeUnit({
			ranges: [
				{
					start: { perekId: 5, pasuk: 1 },
					end: { perekId: 5, pasuk: 5 },
				},
			],
			auxiliaryReadings: [
				{
					id: "haftara",
					label: "הפטרה",
					ranges: [
						{
							start: { perekId: 100, pasuk: 1 },
							end: { perekId: 100, pasuk: 5 },
						},
					],
				},
			],
		});
		expect(unitEquivalentPerekId(unit, pasukCount)).toBeNull();
	});
});
