/**
 * Calendar-PDF artifact addressing (#2608).
 *
 * `/api/calendar-pdf` no longer renders PDFs on the request path. A bounded
 * set of month/year/cycle exports is pre-generated out of band and published
 * to S3; the route only resolves a request to its canonical artifact key and
 * redirects to the published object (see calendar-pdf-manifest.ts).
 *
 * Canonical artifact keys collapse equivalent request URLs onto one artifact:
 *   - `month:YYYYMM` — the padded uniform month (view=month)
 *   - `year:YYYY`    — the Hebrew year (view=year; ignores the month digits)
 *   - `cycle:N`      — the cycle number (view=cycle; ignores `month` entirely)
 *
 * The generated set is bounded on purpose: all Hebrew years touched by the
 * confirmed cycles plus PROJECTED_CYCLE_MARGIN projected cycles, every month
 * of those years, and every cycle 1..max. Valid keys outside the set (future
 * months/cycles) can still be produced out of band (`--include`) and are then
 * served through the manifest even though they are not in the default bounds.
 */

import {
	buildMonth,
	type CalendarDay,
	compareMonths,
	getConfirmedCycleCount,
	getCycle,
	getCycleLabel,
	getCycleStartMonth,
	getMonthLabel,
	getMonthName,
	getMonthOrder,
	getPerekRangeLabel,
	getPerekSource,
	getYearLabel,
	type MonthCell,
	type MonthRef,
	nextMonth,
} from "@/data/learning-schedule";
import type { CalendarPdfInput, CalendarPdfMonth } from "./calendar-pdf";

/** Projected cycles generated beyond the confirmed schedule data. */
export const PROJECTED_CYCLE_MARGIN = 3;

export interface CalendarArtifactBounds {
	/** First Hebrew year covered — the year cycle 1 starts in. */
	minYear: number;
	/** Last Hebrew year covered — the year the last generated cycle ends in. */
	maxYear: number;
	/** Highest generated cycle number. */
	maxCycle: number;
	/** First month key (Tishrei of minYear), e.g. "577501". */
	minMonth: string;
	/** Last month key (Elul of maxYear). */
	maxMonth: string;
}

export function getCalendarArtifactBounds(): CalendarArtifactBounds {
	const maxCycle = getConfirmedCycleCount() + PROJECTED_CYCLE_MARGIN;
	const minYear = getCycle(1).start.year;
	const maxYear = getCycle(maxCycle).end.year;
	return {
		minYear,
		maxYear,
		maxCycle,
		minMonth: `${minYear}01`,
		maxMonth: `${maxYear}12`,
	};
}

function monthKey({ year, month }: MonthRef): string {
	return `${year}${month.toString().padStart(2, "0")}`;
}

/** Every artifact key in the bounded generation set, in a stable order. */
export function listCalendarArtifactKeys(
	bounds: CalendarArtifactBounds = getCalendarArtifactBounds(),
): string[] {
	const keys: string[] = [];
	for (let cycle = 1; cycle <= bounds.maxCycle; cycle++) {
		keys.push(`cycle:${cycle}`);
	}
	for (let year = bounds.minYear; year <= bounds.maxYear; year++) {
		keys.push(`year:${year}`);
		for (const month of getMonthOrder(year)) {
			keys.push(`month:${monthKey({ year, month })}`);
		}
	}
	return keys;
}

export type ParsedCalendarArtifactKey =
	| { view: "month"; year: number; month: number }
	| { view: "year"; year: number }
	| { view: "cycle"; cycle: number };

/**
 * Parses a canonical artifact key, or returns null for malformed keys.
 * Format validity only — a parsed key may still be out of the generated
 * bounds or nonexistent (uniform month 13 in a non-leap year).
 */
export function parseCalendarArtifactKey(
	key: string,
): ParsedCalendarArtifactKey | null {
	const cycle = /^cycle:(\d+)$/.exec(key);
	if (cycle) {
		return { view: "cycle", cycle: Number.parseInt(cycle[1], 10) };
	}
	const year = /^year:(\d{1,4})$/.exec(key);
	if (year) {
		return { view: "year", year: Number.parseInt(year[1], 10) };
	}
	const month = /^month:(\d{4})(\d{2})$/.exec(key);
	if (month) {
		return {
			view: "month",
			year: Number.parseInt(month[1], 10),
			month: Number.parseInt(month[2], 10),
		};
	}
	return null;
}

/**
 * Whether the key describes a calendar artifact that can be generated at
 * all: month keys need a uniform month that exists in that Hebrew year;
 * year keys a plausible Hebrew year; cycle keys a number >= 1.
 */
export function isGeneratableArtifactKey(
	parsed: ParsedCalendarArtifactKey,
): boolean {
	switch (parsed.view) {
		case "cycle":
			return parsed.cycle >= 1;
		case "year":
			return parsed.year >= 1 && parsed.year <= 9999;
		case "month":
			return (
				parsed.year >= 1 &&
				parsed.year <= 9999 &&
				getMonthOrder(parsed.year).includes(parsed.month)
			);
	}
}

/** Download filename for a parsed key — the name the published object carries. */
export function calendarArtifactFilename(
	parsed: ParsedCalendarArtifactKey,
	key: string,
): string {
	switch (parsed.view) {
		case "cycle":
			return `learning-calendar-cycle-${parsed.cycle}.pdf`;
		case "year":
			return `learning-calendar-year-${parsed.year}.pdf`;
		case "month":
			return `learning-calendar-${key.slice("month:".length)}.pdf`;
	}
}

/** Whether the key is inside the bounded generation set. */
export function isInBoundsArtifactKey(
	parsed: ParsedCalendarArtifactKey,
	bounds: CalendarArtifactBounds = getCalendarArtifactBounds(),
): boolean {
	if (!isGeneratableArtifactKey(parsed)) {
		return false;
	}
	switch (parsed.view) {
		case "cycle":
			return parsed.cycle <= bounds.maxCycle;
		case "year":
			return parsed.year >= bounds.minYear && parsed.year <= bounds.maxYear;
		case "month":
			return (
				parsed.year >= bounds.minYear &&
				parsed.year <= bounds.maxYear &&
				getMonthOrder(parsed.year).includes(parsed.month)
			);
	}
}

export type CalendarArtifactResolution =
	| {
			ok: true;
			/** Canonical key — `cycle:N`, `year:YYYY` or `month:YYYYMM`. */
			key: string;
			/** Download filename the published artifact carries. */
			filename: string;
			/** Whether the key is inside the default generated bounds. */
			inBounds: boolean;
	  }
	| { ok: false; error: string };

/**
 * Maps the legacy `/api/calendar-pdf` query semantics onto an artifact key.
 * Mirrors the pre-artifact renderer's precedence exactly: a valid cycle
 * request wins over the month digits, `view=year` uses only the year part,
 * and everything else falls back to the month view — so `view=cycle` with an
 * unusable `cycle` still downloads the month PDF.
 */
export function resolveCalendarArtifactRequest(
	searchParams: URLSearchParams,
	bounds: CalendarArtifactBounds = getCalendarArtifactBounds(),
): CalendarArtifactResolution {
	const monthParam = searchParams.get("month") ?? "";
	const view = searchParams.get("view") ?? "month";
	const cycleParam = Number.parseInt(searchParams.get("cycle") ?? "", 10);

	const year = Number.parseInt(monthParam.slice(0, 4), 10);
	const uniformMonth = Number.parseInt(monthParam.slice(4), 10);

	if (view === "cycle" && Number.isInteger(cycleParam) && cycleParam >= 1) {
		const key = `cycle:${cycleParam}`;
		const parsed: ParsedCalendarArtifactKey = {
			view: "cycle",
			cycle: cycleParam,
		};
		return {
			ok: true,
			key,
			filename: calendarArtifactFilename(parsed, key),
			inBounds: isInBoundsArtifactKey(parsed, bounds),
		};
	}
	if (view === "year" && Number.isInteger(year)) {
		const key = `year:${year}`;
		const parsed: ParsedCalendarArtifactKey = {
			view: "year",
			year,
		};
		return {
			ok: true,
			key,
			filename: calendarArtifactFilename(parsed, key),
			inBounds: isInBoundsArtifactKey(parsed, bounds),
		};
	}
	if (Number.isInteger(year) && Number.isInteger(uniformMonth)) {
		const key = `month:${monthKey({ year, month: uniformMonth })}`;
		const parsed: ParsedCalendarArtifactKey = {
			view: "month",
			year,
			month: uniformMonth,
		};
		return {
			ok: true,
			key,
			filename: calendarArtifactFilename(parsed, key),
			inBounds: isInBoundsArtifactKey(parsed, bounds),
		};
	}
	return {
		ok: false,
		error: "missing or invalid month=YYYYMM (or view/cycle)",
	};
}

function dayLabel(day: CalendarDay): string {
	/* istanbul ignore next -- dayLabel is only invoked for scheduled days (perekId set) */
	if (day.perekId === undefined) {
		return "";
	}
	if (day.status === "review" && day.reviewPerekIds?.length) {
		return getPerekRangeLabel(day.reviewPerekIds);
	}
	return getPerekSource(day.perekId);
}

/**
 * Cell grids are pure data — a month/year/cycle artifact often covers the
 * same Hebrew month. A shared cache lets bulk generation build each month
 * once (dimming stays per-artifact via the `dimmed` closure).
 */
export type MonthCellsCache = Map<string, MonthCell[]>;

function buildCachedMonth(
	year: number,
	month: number,
	cache: MonthCellsCache | undefined,
): MonthCell[] {
	const key = `${year}-${month}`;
	const hit = cache?.get(key);
	if (hit !== undefined) {
		return hit;
	}
	const cells = buildMonth(year, month);
	cache?.set(key, cells);
	return cells;
}

function monthsForCycle(
	cycleNumber: number,
	cellsCache?: MonthCellsCache,
): CalendarPdfMonth[] {
	const cycle = getCycle(cycleNumber);
	const months: CalendarPdfMonth[] = [];
	let ref: MonthRef = getCycleStartMonth(cycle);
	const endRef: MonthRef = {
		year: cycle.end.year,
		month: cycle.end.getUniformMonth(),
	};
	// A 1299-day cycle spans ~44 months; 50 is a defensive bound.
	/* istanbul ignore next -- the bound is defensive; endRef always lands first */
	for (let guard = 0; guard < 50 && compareMonths(ref, endRef) <= 0; guard++) {
		const cells = buildCachedMonth(ref.year, ref.month, cellsCache);
		months.push({ title: getMonthLabel(ref), cells });
		ref = nextMonth(ref);
	}
	return months;
}

/**
 * Builds the renderer input for a canonical key — the same title, subtitle,
 * month cells and cycle dimming the legacy route produced. Returns null for
 * keys that parse but cannot be generated (e.g. a uniform month that does
 * not exist in that Hebrew year). Pass a shared `cellsCache` when building
 * many artifacts so repeated months are only computed once.
 */
export function buildCalendarPdfInput(
	key: string,
	cellsCache?: MonthCellsCache,
): CalendarPdfInput | null {
	const parsed = parseCalendarArtifactKey(key);
	if (!parsed || !isGeneratableArtifactKey(parsed)) {
		return null;
	}
	switch (parsed.view) {
		case "cycle": {
			return {
				title: "לוח לימוד יומי",
				subtitle: getCycleLabel(getCycle(parsed.cycle)),
				months: monthsForCycle(parsed.cycle, cellsCache),
				dimmed: (day) => day.cycle !== parsed.cycle,
				dayLabel,
			};
		}
		case "year": {
			return {
				title: `לוח לימוד יומי - שנת ${getYearLabel(parsed.year)}`,
				months: getMonthOrder(parsed.year).map((month) => ({
					title: getMonthName(parsed.year, month),
					cells: buildCachedMonth(parsed.year, month, cellsCache),
				})),
				dayLabel,
			};
		}
		case "month": {
			const ref: MonthRef = { year: parsed.year, month: parsed.month };
			return {
				title: `לוח לימוד יומי - ${getMonthLabel(ref)}`,
				months: [
					{
						title: getMonthLabel(ref),
						cells: buildCachedMonth(parsed.year, parsed.month, cellsCache),
					},
				],
				dayLabel,
			};
		}
	}
}
