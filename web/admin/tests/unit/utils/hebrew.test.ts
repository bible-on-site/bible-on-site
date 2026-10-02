import { describe, expect, it } from "vitest";
import { formatPerekLabel, toHebrewLetters } from "~/utils/hebrew";

describe("toHebrewLetters", () => {
	it("returns an empty string for zero", () => {
		expect(toHebrewLetters(0)).toBe("");
	});

	it("returns bare letters for single-letter numbers", () => {
		expect(toHebrewLetters(1)).toBe("א");
		expect(toHebrewLetters(2)).toBe("ב");
		expect(toHebrewLetters(9)).toBe("ט");
		expect(toHebrewLetters(10)).toBe("י");
		expect(toHebrewLetters(20)).toBe("כ");
	});

	it("returns bare letters for multi-letter numbers", () => {
		expect(toHebrewLetters(11)).toBe("יא");
		expect(toHebrewLetters(15)).toBe("טו");
		expect(toHebrewLetters(16)).toBe("טז");
		expect(toHebrewLetters(22)).toBe("כב");
		expect(toHebrewLetters(50)).toBe("נ");
	});

	it("handles larger numbers", () => {
		expect(toHebrewLetters(100)).toBe("ק");
		expect(toHebrewLetters(150)).toBe("קנ");
		expect(toHebrewLetters(415)).toBe("תטו");
		expect(toHebrewLetters(500)).toBe("תק");
	});
});

describe("formatPerekLabel", () => {
	describe("when there is no additional", () => {
		it("returns Hebrew perek number only", () => {
			expect(formatPerekLabel(1, null)).toBe("א");
			expect(formatPerekLabel(10, null)).toBe("י");
			expect(formatPerekLabel(15, null)).toBe("טו");
		});
	});

	describe("when there is an additional letter", () => {
		it("prefixes with the additional letter", () => {
			expect(formatPerekLabel(1, "א")).toBe("א א");
			expect(formatPerekLabel(20, "א")).toBe("א כ");
			expect(formatPerekLabel(1, "ב")).toBe("ב א");
			expect(formatPerekLabel(24, "ב")).toBe("ב כד");
		});

		it("handles עזרא additionals (ע/נ)", () => {
			expect(formatPerekLabel(1, "ע")).toBe("ע א");
			expect(formatPerekLabel(5, "נ")).toBe("נ ה");
		});
	});
});
