/**
 * @jest-environment node
 *
 * The shared date-line contract (#3381): a stored date label that
 * already names the month renders alone — no `תשרי · ג' בתשרי` repeats —
 * while a standalone month still shows when the date lacks it, and an
 * empty pair renders nothing.
 */
import {
	moedDateCarriesMonth,
	moedDateLine,
} from "../../../src/lib/moadim/display";

const moed = (hebrewMonth: string | null, dateLabel: string | null) => ({
	hebrewMonth,
	dateLabel,
});

describe("moedDateCarriesMonth", () => {
	it("is true when the date label contains the month", () => {
		expect(moedDateCarriesMonth(moed("תשרי", "ג' בתשרי"))).toBe(true);
		// Multi-day ranges carry the month the same way.
		expect(moedDateCarriesMonth(moed("תשרי", "א'-ב' בתשרי"))).toBe(true);
		expect(moedDateCarriesMonth(moed("כסלו", "כ'ה בכסלו-ב' בטבת"))).toBe(
			true,
		);
	});

	it("is false when the date does not name the month or either is missing", () => {
		expect(moedDateCarriesMonth(moed("ניסן", "ט'ו באייר"))).toBe(false);
		expect(moedDateCarriesMonth(moed("ניסן", null))).toBe(false);
		expect(moedDateCarriesMonth(moed(null, "ג' בתשרי"))).toBe(false);
	});
});

describe("moedDateLine", () => {
	it("renders the date alone when it already carries the month", () => {
		expect(moedDateLine(moed("תשרי", "ג' בתשרי"))).toBe("ג' בתשרי");
		// Multi-day ranges stay intact — no repeated month, no truncation.
		expect(moedDateLine(moed("תשרי", "א'-ב' בתשרי"))).toBe("א'-ב' בתשרי");
		expect(moedDateLine(moed("ניסן", "ט'ו-כ'א בניסן"))).toBe(
			"ט'ו-כ'א בניסן",
		);
	});

	it("joins a standalone month with a date that does not name it", () => {
		expect(moedDateLine(moed("ניסן", "מועד מיוחד"))).toBe(
			"ניסן · מועד מיוחד",
		);
	});

	it("shows a bare month or bare date when the other side is missing", () => {
		expect(moedDateLine(moed("אייר", null))).toBe("אייר");
		expect(moedDateLine(moed(null, "ג' בתשרי"))).toBe("ג' בתשרי");
	});

	it("returns null when neither field carries content", () => {
		expect(moedDateLine(moed(null, null))).toBeNull();
		expect(moedDateLine(moed("", ""))).toBeNull();
	});
});
