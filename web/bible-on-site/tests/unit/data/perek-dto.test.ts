import moment from "moment-timezone";
import {
	getPerekByPerekId,
	getPerekIdByDate,
	getTodaysPerekId,
} from "../../../src/data/perek-dto";

function parseKosherChristianDate(
	dateString: string,
	timeString = "12:00:00",
	timezone = "Asia/Jerusalem", // Default to Jerusalem timezone
): Date {
	const dateParts = dateString.split("/");
	const day = Number.parseInt(dateParts[0], 10);
	const month = new Date(`${dateParts[1]} 1, 2000`).getMonth(); // getMonth() needs a valid year
	const year = Number.parseInt(dateParts[2], 10) + 2000; // Assumes the year is 2024, not 1924
	const timeParts = timeString.split(":");
	const hours = Number.parseInt(timeParts[0], 10);
	const minutes = Number.parseInt(timeParts[1], 10);
	const seconds = Number.parseInt(timeParts[2], 10);

	const date = moment.tz(
		new Date(year, month, day, hours, minutes, seconds),
		timezone,
	);
	return date.toDate();
}

describe("getPerekIdByDate", () => {
	describe("when 21 Sivan 5784", () => {
		it("returns 625", () => {
			const actual = getPerekIdByDate(parseKosherChristianDate("27/June/24"));
			expect(actual).toBe(625);
		});
	});
});

describe("getPerekByPerekId", () => {
	describe("First perek in tanah", () => {
		const actual = getPerekByPerekId(1);
		it("has perekId 1", () => {
			expect(actual.perekId).toBe(1);
		});
		it("has perekHeb א", () => {
			expect(actual.perekHeb).toBe("א");
		});
		it("has header בריאת העולם", () => {
			expect(actual.header).toBe("בריאת העולם");
		});
		it("has helek תורה", () => {
			expect(actual.helek).toBe("תורה");
		});
		it("has sefer בראשית", () => {
			expect(actual.sefer).toBe("בראשית");
		});
		it("has source בראשית א", () => {
			expect(actual.source).toBe("בראשית א");
		});
	});
	describe("Second perek in tanah", () => {
		const actual = getPerekByPerekId(2);
		it("has perekId 2", () => {
			expect(actual.perekId).toBe(2);
		});
		it("has perekHeb א", () => {
			expect(actual.perekHeb).toBe("ב");
		});
		it("has header גן בעדן, אדם ואשתו", () => {
			expect(actual.header).toBe("גן בעדן, אדם ואשתו");
		});
		it("has helek תורה", () => {
			expect(actual.helek).toBe("תורה");
		});
		it("has sefer בראשית", () => {
			expect(actual.sefer).toBe("בראשית");
		});
		it("has source בראשית ב", () => {
			expect(actual.source).toBe("בראשית ב");
		});
	});
	describe("Zero Perek", () => {
		it("throws an error", () => {
			expect(() => getPerekByPerekId(0)).toThrow("Invalid perekId: 0");
		});
	});
	describe("Negative Perek", () => {
		it("throws an error", () => {
			expect(() => getPerekByPerekId(-300)).toThrow("Invalid perekId: -300");
		});
	});
});
describe("getTodaysPerekId", () => {
	const mockDate = parseKosherChristianDate("27/June/24");
	let originalDate: DateConstructor;

	beforeAll(() => {
		originalDate = globalThis.Date;

		// Mock the Date constructor
		function MockDate() {
			return mockDate;
		}
		MockDate.prototype = Date.prototype;
		globalThis.Date = MockDate as unknown as DateConstructor;

		// Mock Date methods
		globalThis.Date.now = jest.fn(() => mockDate.getTime());
	});

	afterAll(() => {
		globalThis.Date = originalDate;
	});

	it("returns 625", () => {
		const actual = getTodaysPerekId();
		expect(actual).toBe(625);
	});
});
