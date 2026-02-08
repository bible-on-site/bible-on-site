import {
	getAllSeferColors,
	getHelekColor,
	getSeferColor,
	isTreiAsar,
	KETUVIM_COLORS,
	NEVIIM_COLORS,
	TORAH_COLORS,
	TREI_ASAR,
} from "../../../src/data/sefer-colors";

describe("getSeferColor", () => {
	it("returns correct color for Torah sefer", () => {
		expect(getSeferColor("בראשית")).toBe("#8B0000");
	});

	it("returns correct color for Neviim sefer", () => {
		expect(getSeferColor("יהושע")).toBe("#191970");
	});

	it("returns correct color for Ketuvim sefer", () => {
		expect(getSeferColor("תהילים")).toBe("#006400");
	});

	it("returns shared color for all Trei Asar sefarim", () => {
		const treiAsarColor = "#4682B4";
		for (const sefer of TREI_ASAR) {
			expect(getSeferColor(sefer)).toBe(treiAsarColor);
		}
	});

	it("returns fallback color for unknown sefer", () => {
		expect(getSeferColor("ספר לא קיים")).toBe("#333333");
	});
});

describe("getHelekColor", () => {
	it("returns dark red for תורה", () => {
		expect(getHelekColor("תורה")).toBe("#8B0000");
	});

	it("returns navy for נביאים", () => {
		expect(getHelekColor("נביאים")).toBe("#000080");
	});

	it("returns dark green for כתובים", () => {
		expect(getHelekColor("כתובים")).toBe("#006400");
	});

	it("returns fallback color for unknown helek", () => {
		expect(getHelekColor("unknown")).toBe("#333333");
	});
});

describe("isTreiAsar", () => {
	it("returns true for each Trei Asar sefer", () => {
		for (const sefer of TREI_ASAR) {
			expect(isTreiAsar(sefer)).toBe(true);
		}
	});

	it("returns false for non-Trei Asar sefer", () => {
		expect(isTreiAsar("ישעיהו")).toBe(false);
		expect(isTreiAsar("בראשית")).toBe(false);
		expect(isTreiAsar("תהילים")).toBe(false);
	});

	it("Trei Asar list has exactly 12 sefarim", () => {
		expect(TREI_ASAR).toHaveLength(12);
	});
});

describe("getAllSeferColors", () => {
	const allColors = getAllSeferColors();

	it("includes all Torah sefarim", () => {
		for (const sefer of Object.keys(TORAH_COLORS)) {
			expect(allColors[sefer]).toBe(TORAH_COLORS[sefer]);
		}
	});

	it("includes all Neviim sefarim", () => {
		for (const sefer of Object.keys(NEVIIM_COLORS)) {
			expect(allColors[sefer]).toBe(NEVIIM_COLORS[sefer]);
		}
	});

	it("includes all Ketuvim sefarim", () => {
		for (const sefer of Object.keys(KETUVIM_COLORS)) {
			expect(allColors[sefer]).toBe(KETUVIM_COLORS[sefer]);
		}
	});

	it("total sefarim count matches sum of all sections", () => {
		const expectedCount =
			Object.keys(TORAH_COLORS).length +
			Object.keys(NEVIIM_COLORS).length +
			Object.keys(KETUVIM_COLORS).length;
		expect(Object.keys(allColors)).toHaveLength(expectedCount);
	});
});
