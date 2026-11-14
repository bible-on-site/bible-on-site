/**
 * @jest-environment node
 *
 * Server actions backing the alternative-division book blank pages
 * (issue #2191): the client names division/unit/scope and the action
 * resolves canonical verse bounds from the division data itself, so
 * carousels and perush notes stay clipped to the selected parasha —
 * with Haftarah scopes reaching the auxiliary-reading union.
 */

jest.mock("next/cache", () => ({
	unstable_cache: (fn: unknown) => fn,
}));

jest.mock("../../../src/lib/perushim", () => ({
	getPerushimForRangeGroups: jest.fn(),
	getPerushNotesForRanges: jest.fn(),
}));

jest.mock("../../../src/lib/articles/service", () => ({
	getArticleSummariesForRangeGroups: jest.fn(),
}));

import {
	getPerakimText,
	getUnitBookPerushNotes,
	getUnitScopeSummariesBatch,
} from "../../../src/app/components/reading/unit-book-actions";
import { getPerekByPerekId } from "../../../src/data/perek-dto";
import { getMasoraUnitById } from "../../../src/data/masora/masora-units";
import {
	getParashaUnitById,
	parashaAuxiliaryRanges,
} from "../../../src/data/parasha/parasha-units";
import { getArticleSummariesForRangeGroups } from "../../../src/lib/articles/service";
import {
	getPerushimForRangeGroups,
	getPerushNotesForRanges,
} from "../../../src/lib/perushim";

const mockGetPerushimForRangeGroups =
	getPerushimForRangeGroups as jest.MockedFunction<
		typeof getPerushimForRangeGroups
	>;
const mockGetPerushNotesForRanges =
	getPerushNotesForRanges as jest.MockedFunction<
		typeof getPerushNotesForRanges
	>;
const mockGetArticleSummariesForRangeGroups =
	getArticleSummariesForRangeGroups as jest.MockedFunction<
		typeof getArticleSummariesForRangeGroups
	>;

describe("getUnitScopeSummariesBatch", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
		mockGetArticleSummariesForRangeGroups.mockImplementation(
			async (groups) => groups.map(() => []),
		);
		mockGetPerushimForRangeGroups.mockImplementation(async (groups) =>
			groups.map(() => []),
		);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("returns per-unit summary pairs keyed by unit id", async () => {
		const articles = [{ id: 7, name: "מאמר" }];
		const perushim = [{ id: 38, name: 'רש"י' }];
		mockGetArticleSummariesForRangeGroups.mockResolvedValue([
			articles,
		] as never);
		mockGetPerushimForRangeGroups.mockResolvedValue([perushim] as never);

		const result = await getUnitScopeSummariesBatch("masora", [8], "torah");

		expect(result["8"]).toEqual({ articles, perushim });
		expect(mockGetArticleSummariesForRangeGroups).toHaveBeenCalledWith([
			getMasoraUnitById(8).ranges,
		]);
		expect(mockGetPerushimForRangeGroups).toHaveBeenCalledWith([
			getMasoraUnitById(8).ranges,
		]);
	});

	it("bounds a haftara batch to the parasha's auxiliary readings", async () => {
		await getUnitScopeSummariesBatch("parasha", [1], "haftara");

		expect(mockGetArticleSummariesForRangeGroups).toHaveBeenCalledWith([
			parashaAuxiliaryRanges(getParashaUnitById(1)),
		]);
		expect(mockGetArticleSummariesForRangeGroups).not.toHaveBeenCalledWith([
			getParashaUnitById(1).ranges,
		]);
	});

	it("rejects a scope outside torah/haftara without querying", async () => {
		const result = await getUnitScopeSummariesBatch(
			"masora",
			[1],
			"bogus" as "torah",
		);

		expect(result).toEqual({});
		expect(mockGetArticleSummariesForRangeGroups).not.toHaveBeenCalled();
	});

	it("skips non-integer and non-positive unit ids but keeps valid ones", async () => {
		const result = await getUnitScopeSummariesBatch(
			"masora",
			[0, -2, 1.5, Number.NaN, 3],
			"torah",
		);

		expect(Object.keys(result)).toEqual(["3"]);
		expect(mockGetArticleSummariesForRangeGroups).toHaveBeenCalledTimes(1);
		expect(mockGetArticleSummariesForRangeGroups).toHaveBeenCalledWith([
			getMasoraUnitById(3).ranges,
		]);
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
		expect(mockGetArticleSummariesForRangeGroups).toHaveBeenCalledWith([[]]);
		expect(mockGetPerushimForRangeGroups).toHaveBeenCalledWith([[]]);
	});

	it("returns empty summaries for an out-of-range unit id", async () => {
		const result = await getUnitScopeSummariesBatch(
			"masora",
			[999999],
			"torah",
		);

		expect(result["999999"]).toEqual({ articles: [], perushim: [] });
		expect(mockGetArticleSummariesForRangeGroups).toHaveBeenCalledWith([[]]);
	});

	it("returns empty summaries when the range-group lookups fail", async () => {
		mockGetArticleSummariesForRangeGroups.mockRejectedValue(
			new Error("DB down"),
		);

		const result = await getUnitScopeSummariesBatch("masora", [8], "torah");

		expect(result["8"]).toEqual({ articles: [], perushim: [] });
		expect(console.warn).toHaveBeenCalledWith(
			"Failed to resolve %s %s summaries batch:",
			"masora",
			"torah",
			"DB down",
		);

		mockGetArticleSummariesForRangeGroups.mockRejectedValue("raw failure");
		const second = await getUnitScopeSummariesBatch("masora", [8], "torah");

		expect(second["8"]).toEqual({ articles: [], perushim: [] });
		expect(console.warn).toHaveBeenCalledWith(
			"Failed to resolve %s %s summaries batch:",
			"masora",
			"torah",
			"raw failure",
		);
	});

	it("falls back to empty summaries for units missing from the group results", async () => {
		// The grouped services align results with the requested groups by
		// index — a short answer still yields one entry per unit.
		mockGetArticleSummariesForRangeGroups.mockResolvedValue([]);
		mockGetPerushimForRangeGroups.mockResolvedValue([]);

		const result = await getUnitScopeSummariesBatch("masora", [3, 8], "torah");

		expect(result["3"]).toEqual({ articles: [], perushim: [] });
		expect(result["8"]).toEqual({ articles: [], perushim: [] });
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

describe("getPerakimText", () => {
	it("returns only the requested perakim with their pesukim", async () => {
		const result = await getPerakimText([335, 336]);

		expect(Object.keys(result).sort()).toEqual(["335", "336"]);
		expect(result[335].pesukim).toEqual(getPerekByPerekId(335).pesukim);
		expect(result[336].pesukim).toEqual(getPerekByPerekId(336).pesukim);
	});

	it("dedupes ids and skips out-of-corpus ids without throwing", async () => {
		const result = await getPerakimText([1, 1, 0, -4, 930, 1.5, Number.NaN]);

		expect(Object.keys(result)).toEqual(["1"]);
	});
});
