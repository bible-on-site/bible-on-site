/**
 * @jest-environment node
 *
 * Bounded-commentary server action (issue #2190): the client names a
 * division, unit, scope and perush — the action resolves the canonical
 * verse bounds from the division data itself and clips notes to them.
 */

jest.mock("next/cache", () => ({
	unstable_cache: (fn: unknown) => fn,
}));

jest.mock("../../../src/lib/perushim", () => ({
	getPerushNotesForRanges: jest.fn(),
}));

import { getUnitPerushNotes } from "../../../src/app/components/reading/actions";
import { getMasoraUnitById } from "../../../src/data/masora/masora-units";
import {
	getParashaUnitById,
	parashaAuxiliaryRanges,
} from "../../../src/data/parasha/parasha-units";
import { getPerushNotesForRanges } from "../../../src/lib/perushim";

const mockGetPerushNotesForRanges =
	getPerushNotesForRanges as jest.MockedFunction<
		typeof getPerushNotesForRanges
	>;

describe("getUnitPerushNotes", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("bounds a מסורה perush to the unit's own ranges", async () => {
		mockGetPerushNotesForRanges.mockResolvedValue([
			{ perekId: 1, pasuk: 2, noteIdx: 0, noteContent: "<p>x</p>" },
		]);

		const result = await getUnitPerushNotes("masora", 1, "torah", 38);

		expect(mockGetPerushNotesForRanges).toHaveBeenCalledWith(
			38,
			getMasoraUnitById(1).ranges,
		);
		expect(result).toHaveLength(1);
	});

	it("bounds a פרשה torah scope to the parasha's primary ranges", async () => {
		mockGetPerushNotesForRanges.mockResolvedValue([]);

		await getUnitPerushNotes("parasha", 1, "torah", 38);

		expect(mockGetPerushNotesForRanges).toHaveBeenCalledWith(
			38,
			getParashaUnitById(1).ranges,
		);
	});

	it("bounds a פרשה haftara scope to the auxiliary-reading union", async () => {
		mockGetPerushNotesForRanges.mockResolvedValue([]);
		const unit = getParashaUnitById(1);

		await getUnitPerushNotes("parasha", 1, "haftara", 38);

		expect(mockGetPerushNotesForRanges).toHaveBeenCalledWith(
			38,
			parashaAuxiliaryRanges(unit),
		);
		// Haftarah bounds must never leak the Torah reading's ranges.
		expect(mockGetPerushNotesForRanges).not.toHaveBeenCalledWith(
			38,
			unit.ranges,
		);
	});

	it.each([
		["masora", 0, "torah", 38],
		["masora", 1, "torah", 0],
		["masora", 1, "bogus", 38],
		["perek", 1, "torah", 38],
	] as const)(
		"rejects invalid input %s %d %s %d without querying",
		async (division, unitId, scope, perushId) => {
			const result = await getUnitPerushNotes(
				division,
				unitId,
				scope as "torah",
				perushId,
			);
			expect(result).toEqual([]);
			expect(mockGetPerushNotesForRanges).not.toHaveBeenCalled();
		},
	);

	it("returns empty for an out-of-range unit id", async () => {
		const result = await getUnitPerushNotes("masora", 999999, "torah", 38);
		expect(result).toEqual([]);
		expect(mockGetPerushNotesForRanges).not.toHaveBeenCalled();
	});

	it("returns empty for a masora unit's haftara scope (no auxiliary readings)", async () => {
		const result = await getUnitPerushNotes("masora", 1, "haftara", 38);
		expect(result).toEqual([]);
		expect(mockGetPerushNotesForRanges).not.toHaveBeenCalled();
	});

	it("returns empty when the service fails", async () => {
		mockGetPerushNotesForRanges.mockRejectedValue(new Error("DB down"));
		const result = await getUnitPerushNotes("masora", 1, "torah", 38);
		expect(result).toEqual([]);
		mockGetPerushNotesForRanges.mockRejectedValue("raw failure");
		expect(await getUnitPerushNotes("masora", 1, "torah", 38)).toEqual([]);
	});
});
