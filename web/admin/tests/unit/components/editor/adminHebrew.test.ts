import { describe, expect, it } from "vitest";
import {
	hebrewNumeral,
	hebrewOrdinalLetter,
} from "~/components/editor/adminHebrew";

describe("adminHebrew", () => {
	describe("hebrewOrdinalLetter", () => {
		it("returns first Hebrew letters for small indices", () => {
			expect(hebrewOrdinalLetter(1)).toBe("א");
			expect(hebrewOrdinalLetter(2)).toBe("ב");
			expect(hebrewOrdinalLetter(22)).toBe("ת");
		});

		it("wraps past 22 for long lists", () => {
			expect(hebrewOrdinalLetter(23)).toBe("א");
			expect(hebrewOrdinalLetter(24)).toBe("ב");
		});

		it("clamps non-positive to א", () => {
			expect(hebrewOrdinalLetter(0)).toBe("א");
			expect(hebrewOrdinalLetter(-3)).toBe("א");
		});
	});

	describe("hebrewNumeral", () => {
		it("numbers the units", () => {
			expect(hebrewNumeral(1)).toBe("א");
			expect(hebrewNumeral(9)).toBe("ט");
		});

		it("numbers the tens", () => {
			expect(hebrewNumeral(10)).toBe("י");
			expect(hebrewNumeral(11)).toBe("יא");
			expect(hebrewNumeral(49)).toBe("מט");
			expect(hebrewNumeral(50)).toBe("נ");
			expect(hebrewNumeral(51)).toBe("נא");
		});

		it("avoids spelling divine names at 15 and 16", () => {
			expect(hebrewNumeral(15)).toBe("טו");
			expect(hebrewNumeral(16)).toBe("טז");
			expect(hebrewNumeral(115)).toBe("קטו");
		});

		it("numbers the hundreds", () => {
			expect(hebrewNumeral(100)).toBe("ק");
			expect(hebrewNumeral(400)).toBe("ת");
			expect(hebrewNumeral(401)).toBe("תא");
			expect(hebrewNumeral(500)).toBe("תק");
		});

		it("clamps invalid input to א", () => {
			expect(hebrewNumeral(0)).toBe("א");
			expect(hebrewNumeral(-2)).toBe("א");
			expect(hebrewNumeral(Number.NaN)).toBe("א");
		});
	});
});
