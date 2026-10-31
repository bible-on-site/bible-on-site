import { describe, expect, it } from "vitest";
import { previewDedicationLine } from "~/lib/dedication-line";

// Same wording table as the website formatDedication and native
// DedicationFormatter tests (#2849).
describe("previewDedicationLine", () => {
	it.each([
		["לרפואה", ["לרפואה"], "מזל בת רחל", "לרפואת מזל בת רחל"],
		["רפואה שלימה", ["רפואה שלימה"], "מזל בת רחל", "לרפואת מזל בת רחל"],
		[
			"already normalized לרפואת",
			["לרפואת"],
			"ראובן בן יקוט",
			"לרפואת ראובן בן יקוט",
		],
		[
			"padded healing variant",
			["  רפואה   שלמה "],
			"מזל בת רחל",
			"לרפואת מזל בת רחל",
		],
		['לע"נ', ['לע"נ'], "יעל בת רחל", 'לע"נ יעל בת רחל'],
		["legacy gershayim", ["לע״נ"], "יעל בת רחל", 'לע"נ יעל בת רחל'],
		["no purposes", [], "יעל בת רחל", "יעל בת רחל"],
		["blank purposes only", ["  ", ""], "יעל בת רחל", "יעל בת רחל"],
		[
			"multiple and custom purposes",
			["רפואה שלימה", "להצלחת"],
			"מזל בת רחל",
			"לרפואת ולהצלחת מזל בת רחל",
		],
		[
			"duplicate healing variants",
			["לרפואה", "רפואה שלימה"],
			"מזל בת רחל",
			"לרפואת מזל בת רחל",
		],
		[
			"subject starting with ל kept exactly",
			["לרפואה"],
			"לאה בת שרה",
			"לרפואת לאה בת שרה",
		],
	])("renders %s purpose-first", (_case, purposes, subject, expected) => {
		const line = previewDedicationLine(subject, purposes);
		expect(line).toBe(expected);
		expect(line).not.toContain("מוקדש");
		expect(line).not.toMatch(/[()]/);
	});
});
