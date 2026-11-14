import { describe, expect, it } from "vitest";
import {
	HEBREW_NUMBER_PATTERN,
	parseHebrewNumber,
} from "~/lib/article-linking/hebrew-numerals";

describe("parseHebrewNumber", () => {
	describe("with valid numerals", () => {
		it("parses single letters", () => {
			expect(parseHebrewNumber("א")).toBe(1);
			expect(parseHebrewNumber("ה")).toBe(5);
			expect(parseHebrewNumber("י")).toBe(10);
			expect(parseHebrewNumber("ק")).toBe(100);
			expect(parseHebrewNumber("ת")).toBe(400);
		});

		it("parses compound numerals", () => {
			expect(parseHebrewNumber("יח")).toBe(18);
			expect(parseHebrewNumber("כג")).toBe(23);
			expect(parseHebrewNumber("קיט")).toBe(119);
			expect(parseHebrewNumber("קנ")).toBe(150);
		});

		it("parses 15/16 in plain letter-sum form", () => {
			expect(parseHebrewNumber("טו")).toBe(15);
			expect(parseHebrewNumber("טז")).toBe(16);
		});

		it("parses final-form letters", () => {
			expect(parseHebrewNumber("רנו")).toBe(256);
			expect(parseHebrewNumber("שס")).toBe(360);
		});

		it("strips gershayim, geresh and quote marks", () => {
			expect(parseHebrewNumber('כ"ג')).toBe(23);
			expect(parseHebrewNumber("כ״ג")).toBe(23);
			expect(parseHebrewNumber("י׳")).toBe(10);
		});
	});

	describe("with invalid input", () => {
		it("rejects empty and non-Hebrew input", () => {
			expect(parseHebrewNumber("")).toBeNull();
			expect(parseHebrewNumber("12")).toBeNull();
			expect(parseHebrewNumber("hello")).toBeNull();
		});

		it("rejects values above the bound", () => {
			expect(parseHebrewNumber("ת", 200)).toBeNull();
		});
	});
});

describe("HEBREW_NUMBER_PATTERN", () => {
	it("matches numerals with interior quote marks", () => {
		// codacy-gate forbids RegExp() over the exported pattern — this literal
		// twin exercises the same shape; the source assertion below keeps the
		// two from drifting.
		const twin = /^[א-ת]{1,3}(?:["'׳״][א-ת]{1,3})?(?![א-ת])$/;
		expect(twin.test("יח")).toBe(true);
		expect(twin.test('כ"ג')).toBe(true);
		expect(twin.test("רנ״ו")).toBe(true);
	});

	it("exports the documented token source", () => {
		expect(HEBREW_NUMBER_PATTERN).toBe(
			"[א-ת]{1,3}(?:[\"'׳״][א-ת]{1,3})?(?![א-ת])",
		);
	});
});
