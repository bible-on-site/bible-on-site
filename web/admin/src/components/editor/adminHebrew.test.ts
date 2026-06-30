import { describe, expect, it } from "vitest";
import { hebrewOrdinalLetter } from "./adminHebrew";

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
});
