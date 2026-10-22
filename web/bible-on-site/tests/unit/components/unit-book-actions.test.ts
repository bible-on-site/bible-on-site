/**
 * @jest-environment node
 *
 * Server actions backing the alternative-division book blank pages
 * (issue #2191): the client names division/unit/scope and the action
 * resolves canonical verse bounds from the division data itself, so
 * carousels and perush notes stay clipped to the selected parasha —
 * with Haftarah scopes reaching the auxiliary-reading union.
 */

jest.mock("../../../src/lib/perushim", () => ({
	getPerushimForRanges: jest.fn(),
	getPerushNotesForRanges: jest.fn(),
}));

jest.mock("../../../src/lib/articles/service", () => ({
	getArticleSummariesForRanges: jest.fn(),
}));

import {
	getUnitBookPerushNotes,
	getUnitScopeSummariesBatch,
} from "../../../src/app/components/reading/unit-book-actions";
import { getMasoraUnitById } from "../../../src/data/masora/masora-units";
import {
	getParashaUnitById,
	parashaAuxiliaryRanges,
} from "../../../src/data/parasha/parasha-units";
import { getArticleSummariesForRanges } from "../../../src/lib/articles/service";
import {
	getPerushimForRanges,
	getPerushNotesForRanges,
} from "../../../src/lib/perushim";

const mockGetPerushimForRanges = getPerushimForRanges as jest.MockedFunction<
	typeof getPerushimForRanges
>;
const mockGetPerushNotesForRanges =
	getPerushNotesForRanges as jest.MockedFunction<
		typeof getPerushNotesForRanges
	>;
const mockGetArticleSummariesForRanges =
	getArticleSummariesForRanges as jest.MockedFunction<
		typeof getArticleSummariesForRanges
	>;

describe("getUnitScopeSummariesBatch", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
		mockGetArticleSummariesForRanges.mockResolvedValue([]);
		mockGetPerushimForRanges.mockResolvedValue([]);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("returns per-unit summary pairs keyed by unit id", async () => {
		const articles = [{ id: 7, name: "מאמר" }];
		const perushim = [{ id: 38, name: 'רש"י' }];
		mockGetArticleSummariesForRanges.mockResolvedValue(articles as never);
		mockGetPerushimForRanges.mockResolvedValue(perushim as never);

		const result = await getUnitScopeSummariesBatch("masora", [8], "torah");

		expect(result["8"]).toEqual({ articles, perushim });
		expect(mockGetArticleSummariesForRanges).toHaveBeenCalledWith(
			getMasoraUnitById(8).ranges,
		);
		expect(mockGetPerushimForRanges).toHaveBeenCalledWith(
			getMasoraUnitById(8).ranges,
		);
	});

	it("bounds a haftara batch to the parasha's auxiliary readings", async () => {
		await getUnitScopeSummariesBatch("parasha", [1], "haftara");

		expect(mockGetArticleSummariesForRanges).toHaveBeenCalledWith(
			parashaAuxiliaryRanges(getParashaUnitById(1)),
		);
		expect(mockGetArticleSummariesForRanges).not.toHaveBeenCalledWith(
			getParashaUnitById(1).ranges,
		);
	});

	it("rejects a scope outside torah/haftara without querying", async () => {
		const result = await getUnitScopeSummariesBatch(
			"masora",
			[1],
			"bogus" as "torah",
		);

		expect(result).toEqual({});
		expect(mockGetArticleSummariesForRanges).not.toHaveBeenCalled();
	});

	it("skips non-integer and non-positive unit ids but keeps valid ones", async () => {
		const result = await getUnitScopeSummariesBatch(
			"masora",
			[0, -2, 1.5, Number.NaN, 3],
			"torah",
		);

		expect(Object.keys(result)).toEqual(["3"]);
		expect(mockGetArticleSummariesForRanges).toHaveBeenCalledTimes(1);
	});

	it("returns empty summaries for a division/scope pair with no ranges", async () => {
		// A Masoretic unit carries no auxiliary readings — asking its
		// haftara scope resolves to an empty bound without querying.
		const result = await getUnitScopeSummariesBatch(
			"masora",
			[8],
			"haftara",
		);

		expect(result["8"]).toEqual({ articles: [], perushim: [] });
		expect(mockGetArticleSummariesForRanges).not.toHaveBeenCalled();
		expect(mockGetPerushimForRanges).not.toHaveBeenCalled();
	});

	it("returns empty summaries for an out-of-range unit id", async () => {
		const result = await getUnitScopeSummariesBatch(
			"masora",
			[999999],
			"torah",
		);

		expect(result["999999"]).toEqual({ articles: [], perushim: [] });
		expect(mockGetArticleSummariesForRanges).not.toHaveBeenCalled();
	});

	it("returns empty summaries when the range-bound lookups fail", async () => {
		mockGetArticleSummariesForRanges.mockRejectedValue(new Error("DB down"));

		const result = await getUnitScopeSummariesBatch("masora", [8], "torah");

		expect(result["8"]).toEqual({ articles: [], perushim: [] });
		expect(console.warn).toHaveBeenCalled();
	});
});

describe("getUnitBookPerushNotes", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
		mockGetPerushNotesForRanges.mockResolvedValue([]);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("bounds a masora perush's notes to the unit's own ranges", async () => {
		await getUnitBookPerushNotes("masora", 8, "torah", 38);

		expect(mockGetPerushNotesForRanges).toHaveBeenCalledWith(
			38,
			getMasoraUnitById(8).ranges,
		);
	});

	it("bounds a parasha haftara scope to the auxiliary readings", async () => {
		await getUnitBookPerushNotes("parasha", 1, "haftara", 38);

		expect(mockGetPerushNotesForRanges).toHaveBeenCalledWith(
			38,
			parashaAuxiliaryRanges(getParashaUnitById(1)),
		);
	});

	it.each([
		["masora", 1, "torah", 0],
		["masora", 1, "torah", 1.5],
		["masora", 0, "torah", 38],
		["masora", 1, "bogus", 38],
	] as const)(
		"rejects invalid input %s %d %s %d without querying",
		async (division, unitId, scope, perushId) => {
			const result = await getUnitBookPerushNotes(
				division,
				unitId,
				scope as "torah",
				perushId,
			);

			expect(result).toEqual([]);
			expect(mockGetPerushNotesForRanges).not.toHaveBeenCalled();
		},
	);

	it("returns empty when the unit resolves to no ranges", async () => {
		const result = await getUnitBookPerushNotes(
			"masora",
			999999,
			"torah",
			38,
		);

		expect(result).toEqual([]);
		expect(mockGetPerushNotesForRanges).not.toHaveBeenCalled();
	});

	it("returns empty when the notes lookup fails", async () => {
		mockGetPerushNotesForRanges.mockRejectedValue(new Error("DB down"));
		expect(await getUnitBookPerushNotes("masora", 8, "torah", 38)).toEqual(
			[],
		);
		expect(console.warn).toHaveBeenCalled();

		mockGetPerushNotesForRanges.mockRejectedValue("raw failure");
		expect(await getUnitBookPerushNotes("masora", 8, "torah", 38)).toEqual(
			[],
		);
	});
});
