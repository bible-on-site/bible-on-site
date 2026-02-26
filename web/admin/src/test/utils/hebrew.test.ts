import { describe, expect, it } from "vitest";
import { formatPerekLabel, toHebrewWithPunctuation } from "../../utils/hebrew";

describe("toHebrewWithPunctuation", () => {
	it("returns single letter with geresh for single-digit numbers", () => {
		expect(toHebrewWithPunctuation(1)).toBe("א'");
		expect(toHebrewWithPunctuation(2)).toBe("ב'");
		expect(toHebrewWithPunctuation(9)).toBe("ט'");
		expect(toHebrewWithPunctuation(10)).toBe("י'");
		expect(toHebrewWithPunctuation(20)).toBe("כ'");
	});

	it("returns letters with gershayim for multi-letter numbers", () => {
		expect(toHebrewWithPunctuation(11)).toBe('י"א');
		expect(toHebrewWithPunctuation(15)).toBe('ט"ו');
		expect(toHebrewWithPunctuation(16)).toBe('ט"ז');
		expect(toHebrewWithPunctuation(22)).toBe('כ"ב');
		expect(toHebrewWithPunctuation(50)).toBe("נ'");
	});

	it("handles larger numbers", () => {
		expect(toHebrewWithPunctuation(100)).toBe("ק'");
		expect(toHebrewWithPunctuation(150)).toBe('ק"נ');
	});
});

describe("formatPerekLabel", () => {
	describe("when there is no additional", () => {
		it("returns Hebrew perek number only", () => {
			expect(formatPerekLabel(1, null)).toBe("א'");
			expect(formatPerekLabel(10, null)).toBe("י'");
			expect(formatPerekLabel(15, null)).toBe('ט"ו');
		});
	});

	describe("when there is an additional letter", () => {
		it("prefixes with the additional letter", () => {
			expect(formatPerekLabel(1, "א")).toBe("א א'");
			expect(formatPerekLabel(20, "א")).toBe("א כ'");
			expect(formatPerekLabel(1, "ב")).toBe("ב א'");
			expect(formatPerekLabel(24, "ב")).toBe('ב כ"ד');
		});

		it("handles עזרא additionals (ע/נ)", () => {
			expect(formatPerekLabel(1, "ע")).toBe("ע א'");
			expect(formatPerekLabel(5, "נ")).toBe("נ ה'");
		});
	});
});
