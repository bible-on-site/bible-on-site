/**
 * @jest-environment node
 */

import {
	getConfirmedCycleCount,
	getCycle,
	getMonthOrder,
} from "@/data/learning-schedule";
import {
	buildCalendarPdfInput,
	calendarArtifactFilename,
	getCalendarArtifactBounds,
	isGeneratableArtifactKey,
	isInBoundsArtifactKey,
	listCalendarArtifactKeys,
	PROJECTED_CYCLE_MARGIN,
	parseCalendarArtifactKey,
	resolveCalendarArtifactRequest,
} from "@/lib/download/calendar-artifacts";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

describe("getCalendarArtifactBounds", () => {
	it("covers the confirmed cycles plus the projected margin", () => {
		const bounds = getCalendarArtifactBounds();
		expect(bounds.maxCycle).toBe(
			getConfirmedCycleCount() + PROJECTED_CYCLE_MARGIN,
		);
		expect(bounds.minYear).toBe(getCycle(1).start.year);
		expect(bounds.maxYear).toBe(getCycle(bounds.maxCycle).end.year);
		expect(bounds.minMonth).toBe(`${bounds.minYear}01`);
		expect(bounds.maxMonth).toBe(`${bounds.maxYear}12`);
	});
});

describe("listCalendarArtifactKeys", () => {
	it("lists every cycle, year and month in the bounded set", () => {
		const bounds = getCalendarArtifactBounds();
		const keys = listCalendarArtifactKeys(bounds);
		const cycles = keys.filter((k) => k.startsWith("cycle:"));
		const years = keys.filter((k) => k.startsWith("year:"));
		const months = keys.filter((k) => k.startsWith("month:"));
		expect(cycles).toHaveLength(bounds.maxCycle);
		expect(years).toHaveLength(bounds.maxYear - bounds.minYear + 1);
		let expectedMonths = 0;
		for (let y = bounds.minYear; y <= bounds.maxYear; y++) {
			expectedMonths += getMonthOrder(y).length;
		}
		expect(months).toHaveLength(expectedMonths);
		// Stable, deduplicated order.
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("parseCalendarArtifactKey", () => {
	it("parses canonical keys", () => {
		expect(parseCalendarArtifactKey("cycle:4")).toEqual({
			view: "cycle",
			cycle: 4,
		});
		expect(parseCalendarArtifactKey("year:5785")).toEqual({
			view: "year",
			year: 5785,
		});
		expect(parseCalendarArtifactKey("month:578512")).toEqual({
			view: "month",
			year: 5785,
			month: 12,
		});
	});

	it("rejects malformed keys", () => {
		expect(parseCalendarArtifactKey("cycle:")).toBeNull();
		expect(parseCalendarArtifactKey("cycle:0x4")).toBeNull();
		expect(parseCalendarArtifactKey("month:57851")).toBeNull();
		expect(parseCalendarArtifactKey("month:5785120")).toBeNull();
		expect(parseCalendarArtifactKey("year:")).toBeNull();
		expect(parseCalendarArtifactKey("bogus:1")).toBeNull();
		expect(parseCalendarArtifactKey("month:5785a2")).toBeNull();
	});
});

describe("isGeneratableArtifactKey", () => {
	it("accepts plausible keys", () => {
		expect(isGeneratableArtifactKey({ view: "cycle", cycle: 40 })).toBe(true);
		expect(isGeneratableArtifactKey({ view: "year", year: 5785 })).toBe(true);
		expect(
			isGeneratableArtifactKey({ view: "month", year: 5785, month: 1 }),
		).toBe(true);
	});

	it("rejects impossible keys", () => {
		expect(isGeneratableArtifactKey({ view: "cycle", cycle: 0 })).toBe(false);
		expect(isGeneratableArtifactKey({ view: "year", year: 0 })).toBe(false);
		expect(isGeneratableArtifactKey({ view: "year", year: 10000 })).toBe(false);
		expect(
			isGeneratableArtifactKey({ view: "month", year: 5785, month: 15 }),
		).toBe(false);
		// Uniform month 13/14 only exist in leap years — 5785 is not leap.
		expect(
			isGeneratableArtifactKey({ view: "month", year: 5785, month: 13 }),
		).toBe(false);
		expect(
			isGeneratableArtifactKey({ view: "month", year: 5784, month: 13 }),
		).toBe(true);
	});
});

describe("isInBoundsArtifactKey", () => {
	const bounds = getCalendarArtifactBounds();
	it("accepts keys inside the generated set", () => {
		expect(
			isInBoundsArtifactKey({ view: "cycle", cycle: bounds.maxCycle }, bounds),
		).toBe(true);
		expect(
			isInBoundsArtifactKey({ view: "year", year: bounds.minYear }, bounds),
		).toBe(true);
		expect(
			isInBoundsArtifactKey(
				{ view: "month", year: bounds.minYear, month: 6 },
				bounds,
			),
		).toBe(true);
	});

	it("rejects keys outside the generated set", () => {
		expect(
			isInBoundsArtifactKey(
				{ view: "cycle", cycle: bounds.maxCycle + 1 },
				bounds,
			),
		).toBe(false);
		expect(
			isInBoundsArtifactKey({ view: "year", year: bounds.maxYear + 1 }, bounds),
		).toBe(false);
		expect(
			isInBoundsArtifactKey(
				{ view: "month", year: bounds.minYear - 1, month: 1 },
				bounds,
			),
		).toBe(false);
		expect(
			isInBoundsArtifactKey({ view: "month", year: 5785, month: 13 }, bounds),
		).toBe(false);
	});

	it("defaults to the live artifact bounds when none are passed", () => {
		expect(isInBoundsArtifactKey({ view: "cycle", cycle: 1 })).toBe(true);
		expect(
			isInBoundsArtifactKey({ view: "cycle", cycle: bounds.maxCycle + 1 }),
		).toBe(false);
	});
});

describe("calendarArtifactFilename", () => {
	it("preserves the legacy download filenames", () => {
		expect(
			calendarArtifactFilename({ view: "cycle", cycle: 4 }, "cycle:4"),
		).toBe("learning-calendar-cycle-4.pdf");
		expect(
			calendarArtifactFilename({ view: "year", year: 5785 }, "year:5785"),
		).toBe("learning-calendar-year-5785.pdf");
		expect(
			calendarArtifactFilename(
				{ view: "month", year: 5785, month: 12 },
				"month:578512",
			),
		).toBe("learning-calendar-578512.pdf");
	});
});

describe("resolveCalendarArtifactRequest", () => {
	const resolve = (query: string) =>
		resolveCalendarArtifactRequest(new URLSearchParams(query));

	it("resolves month requests to the canonical month key", () => {
		expect(resolve("month=578512")).toEqual({
			ok: true,
			key: "month:578512",
			filename: "learning-calendar-578512.pdf",
			inBounds: true,
		});
		// Canonical padding: equivalent spellings share the artifact.
		expect(resolve("month=57851")).toMatchObject({
			ok: true,
			key: "month:578501",
		});
	});

	it("resolves cycle requests — ignoring the month param entirely", () => {
		for (const query of [
			"month=578702&view=cycle&cycle=4",
			"view=cycle&cycle=4",
			"month=999999&view=cycle&cycle=4",
		]) {
			expect(resolve(query)).toEqual({
				ok: true,
				key: "cycle:4",
				filename: "learning-calendar-cycle-4.pdf",
				inBounds: true,
			});
		}
	});

	it("resolves year requests from the year part of the month param", () => {
		expect(resolve("month=578501&view=year")).toEqual({
			ok: true,
			key: "year:5785",
			filename: "learning-calendar-year-5785.pdf",
			inBounds: true,
		});
		// The legacy API also accepted a bare year in the month param.
		expect(resolve("month=5785&view=year")).toMatchObject({
			ok: true,
			key: "year:5785",
		});
	});

	it("falls back to the month view for an unusable cycle param", () => {
		for (const cycle of ["abc", "0", "-3", ""]) {
			expect(resolve(`month=578512&view=cycle&cycle=${cycle}`)).toMatchObject({
				ok: true,
				key: "month:578512",
			});
		}
	});

	it("flags out-of-bounds requests without rejecting them", () => {
		expect(resolve("month=999912")).toMatchObject({
			ok: true,
			inBounds: false,
		});
		expect(resolve("month=578512&view=cycle&cycle=999")).toMatchObject({
			ok: true,
			key: "cycle:999",
			inBounds: false,
		});
		expect(resolve("month=000101")).toMatchObject({
			ok: true,
			inBounds: false,
		});
	});

	it("rejects unparseable requests", () => {
		for (const query of [
			"",
			"month=abc",
			"month=5785",
			"month=abcdef&view=year",
		]) {
			expect(resolve(query)).toEqual({
				ok: false,
				error: "missing or invalid month=YYYYMM (or view/cycle)",
			});
		}
	});

	it("respects an explicit bounds override", () => {
		const narrow = {
			minYear: 5786,
			maxYear: 5787,
			maxCycle: 6,
			minMonth: "578601",
			maxMonth: "578712",
		};
		const resolved = resolveCalendarArtifactRequest(
			new URLSearchParams("month=578512"),
			narrow,
		);
		expect(resolved.ok).toBe(true);
		if (resolved.ok) {
			expect(resolved.inBounds).toBe(false);
		}
	});
});

describe("buildCalendarPdfInput", () => {
	it("builds a month input matching the legacy route shape", () => {
		const input = buildCalendarPdfInput("month:578512");
		expect(input).not.toBeNull();
		expect(input?.scope).toBe("month");
		expect(input?.title).toContain("לוח לימוד יומי");
		expect(input?.title).toContain('תנ"ך על הפרק');
		expect(input?.months).toHaveLength(1);
		expect(input?.months[0].year).toBe(5785);
		expect(input?.months[0].month).toBe(12);
		expect(input?.months[0].cells.length).toBeGreaterThan(28);
		expect(input?.linkBase).toBe(`${SITE_ORIGIN}/929`);
		expect(input?.dimmed).toBeUndefined();
	});

	it("builds a year input covering every month", () => {
		const input = buildCalendarPdfInput("year:5784");
		expect(input?.scope).toBe("year");
		expect(input?.title).toContain("שנת");
		expect(input?.title).toContain('תנ"ך על הפרק');
		expect(input?.months.length).toBe(getMonthOrder(5784).length);
		expect(input?.months[0].year).toBe(5784);
		expect(input?.subtitle).toBeUndefined();
	});

	it("builds a cycle input with dimmed out-of-cycle days", () => {
		const input = buildCalendarPdfInput("cycle:4");
		expect(input).not.toBeNull();
		expect(input?.scope).toBe("cycle");
		expect(input?.title).toContain("מחזור ד'");
		// Subtitle is the cycle's Hebrew date range, not the "מחזור ד'" label.
		expect(input?.subtitle).toContain("-");
		expect(input?.months.length).toBeGreaterThan(30);
		const dimmed = input?.dimmed;
		expect(typeof dimmed).toBe("function");
		// A day belonging to the cycle is not dimmed; one outside is.
		const inCycle = input?.months
			.flatMap((m) => m.cells)
			.find((c) => c.day?.cycle === 4);
		const outCycle = input?.months
			.flatMap((m) => m.cells)
			.find((c) => c.day !== undefined && c.day.cycle !== 4);
		const inCycleDay = inCycle?.day;
		if (inCycleDay === undefined || dimmed === undefined) {
			throw new Error("expected an in-cycle scheduled day");
		}
		expect(dimmed(inCycleDay)).toBe(false);
		if (outCycle?.day) {
			expect(dimmed(outCycle.day)).toBe(true);
		}
	});

	it("marks a projected cycle's range subtitle as estimated (#2727)", () => {
		const projected = getConfirmedCycleCount() + 1;
		const input = buildCalendarPdfInput(`cycle:${projected}`);
		expect(input).not.toBeNull();
		expect(input?.subtitle).toContain("(משוער)");
	});

	it("returns null for non-generatable keys", () => {
		expect(buildCalendarPdfInput("month:578513")).toBeNull();
		expect(buildCalendarPdfInput("bogus")).toBeNull();
		expect(buildCalendarPdfInput("cycle:0")).toBeNull();
	});

	it("reuses cell grids across views via the shared cache", () => {
		const cache = new Map();
		const month = buildCalendarPdfInput("month:578512", cache);
		const year = buildCalendarPdfInput("year:5785", cache);
		const monthCells = month?.months[0].cells;
		const yearMonth = year?.months.find((m) => m.cells === monthCells);
		expect(yearMonth).toBeDefined();
	});
});
