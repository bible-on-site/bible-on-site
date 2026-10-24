import {
	clearSeferPasukSelection,
	getSeferPasukSelection,
	isSeferPasukSelectionMode,
	resetSeferPasukSelectionState,
	setSeferPasukSelectionMode,
	toggleSeferPasuk,
} from "../../../src/app/929/[number]/components/sefer-pasuk-selection";

beforeEach(() => {
	resetSeferPasukSelectionState();
});

describe("sefer-pasuk-selection store", () => {
	it("defaults to the whole perek: empty selection and mode off", () => {
		expect(getSeferPasukSelection(1).size).toBe(0);
		expect(isSeferPasukSelectionMode(1)).toBe(false);
	});

	it("toggles pesukim per perek without leaking into other perakim", () => {
		toggleSeferPasuk(1, 3);
		toggleSeferPasuk(1, 5);
		toggleSeferPasuk(2, 3);

		expect([...getSeferPasukSelection(1)].sort()).toEqual([3, 5]);
		expect([...getSeferPasukSelection(2)]).toEqual([3]);
		expect(getSeferPasukSelection(3).size).toBe(0);
	});

	it("drops the perek entry when the last selected pasuk is untoggled", () => {
		toggleSeferPasuk(1, 2);
		expect(getSeferPasukSelection(1).has(2)).toBe(true);
		toggleSeferPasuk(1, 2);
		expect(getSeferPasukSelection(1).size).toBe(0);
	});

	it("clear restores the whole-perek selection", () => {
		toggleSeferPasuk(1, 1);
		toggleSeferPasuk(1, 2);
		clearSeferPasukSelection(1);
		expect(getSeferPasukSelection(1).size).toBe(0);
		expect(isSeferPasukSelectionMode(1)).toBe(false);
	});

	it("keeps selection mode independent per perek", () => {
		setSeferPasukSelectionMode(1, true);
		setSeferPasukSelectionMode(2, false);
		expect(isSeferPasukSelectionMode(1)).toBe(true);
		expect(isSeferPasukSelectionMode(2)).toBe(false);
		setSeferPasukSelectionMode(1, false);
		expect(isSeferPasukSelectionMode(1)).toBe(false);
	});

	it("returns a referentially stable snapshot for unchanged state", () => {
		const before = getSeferPasukSelection(1);
		toggleSeferPasuk(9, 1);
		expect(getSeferPasukSelection(1)).toBe(before);
	});
});
