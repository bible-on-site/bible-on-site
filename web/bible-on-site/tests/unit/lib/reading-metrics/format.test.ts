/**
 * Display-policy tests for the shared reading metrics (#2607).
 */
import {
	formatEstimatedReadingTime,
	formatReadingTimeLabel,
	isoDurationSeconds,
	READING_TIME_LABEL,
} from "../../../../src/lib/reading-metrics";

describe("formatEstimatedReadingTime", () => {
	it("returns null for unknown metrics", () => {
		expect(formatEstimatedReadingTime(null)).toBeNull();
		expect(formatEstimatedReadingTime(undefined)).toBeNull();
	});

	it("returns null for verified-empty content (no fabricated minute)", () => {
		expect(formatEstimatedReadingTime(0)).toBeNull();
		expect(formatEstimatedReadingTime(-3)).toBeNull();
	});

	it("shows 'less than a minute' under 60 seconds", () => {
		expect(formatEstimatedReadingTime(1)).toBe("פחות מדקה");
		expect(formatEstimatedReadingTime(59)).toBe("פחות מדקה");
	});

	it("rounds up whole minutes at and above 60 seconds", () => {
		expect(formatEstimatedReadingTime(60)).toBe("דקה");
		expect(formatEstimatedReadingTime(61)).toBe("2 דקות");
		expect(formatEstimatedReadingTime(99)).toBe("2 דקות");
		expect(formatEstimatedReadingTime(240)).toBe("4 דקות");
		expect(formatEstimatedReadingTime(241)).toBe("5 דקות");
	});
});

describe("formatReadingTimeLabel", () => {
	it("prefixes the shared label", () => {
		expect(READING_TIME_LABEL).toBe("זמן קריאה משוער");
		expect(formatReadingTimeLabel(240)).toBe("זמן קריאה משוער: 4 דקות");
	});

	it("returns null when there is nothing to show", () => {
		expect(formatReadingTimeLabel(null)).toBeNull();
		expect(formatReadingTimeLabel(0)).toBeNull();
	});
});

describe("isoDurationSeconds", () => {
	it("emits ISO-8601 PT<n>S", () => {
		expect(isoDurationSeconds(99)).toBe("PT99S");
		expect(isoDurationSeconds(0)).toBe("PT0S");
		expect(isoDurationSeconds(59.6)).toBe("PT60S");
	});
});
