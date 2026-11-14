import type { PageSemantics } from "html-flip-book-react";
import {
	buildVisibleCalendarMonth,
	type CalendarCycleWindow,
	visibleCalendarMonths,
} from "@/data/learning-calendar-policy";
import {
	compareMonths,
	getCycle,
	getCycleStartMonth,
	getMonthLabel,
	getMonthName,
	getYearLabel,
	nextMonth,
	type MonthCell,
	type MonthRef,
} from "@/data/learning-schedule";

/**
 * Pure helpers for the vertical spiral calendar book (#2993): page layout,
 * month↔page index math and page semantics. Kept free of flip-book runtime
 * imports so unit tests exercise them without the engine.
 */

export const CALENDAR_WEEKDAYS = [
	{ short: "א", full: "ראשון" },
	{ short: "ב", full: "שני" },
	{ short: "ג", full: "שלישי" },
	{ short: "ד", full: "רביעי" },
	{ short: "ה", full: "חמישי" },
	{ short: "ו", full: "שישי" },
	{ short: "ש", full: "שבת" },
] as const;

/** One month sheet inside the flip book, in chronological page order. */
export interface FlipMonthEntry {
	ref: MonthRef;
	/**
	 * Compact label used for page semantics/jump: the bare month name inside a
	 * single-year book ("תשרי"), month + year inside a cycle book
	 * ("תשרי ה'תשפ\"ו") so repeated month names stay unique.
	 */
	semanticName: string;
	cells: MonthCell[];
}

/**
 * Chrome faces wrapped around the month sheets, matching the physical book:
 * front cover, blank endpaper, title page … months … blank endpaper, back
 * cover. The first month's readable face always sits at this page index.
 */
export const FLIP_MONTH_PAGE_OFFSET = 3;

/**
 * Each month owns a whole visible pair — its readable sheet face plus the
 * companion card-back face beneath it — exactly like the Sefer reader's
 * two faces per perek. A leaf turn advances two page indices, so packing
 * months onto single faces would make every second month unreachable as
 * the top readable sheet.
 */
export function flipBookPageCount(monthCount: number): number {
	return monthCount * 2 + 5;
}

/** Page index of the readable sheet face at `position` (0-based). */
export function flipMonthPageIndex(position: number): number {
	return FLIP_MONTH_PAGE_OFFSET + position * 2;
}

/**
 * Ordered month sheets of one Hebrew year (12 or 13 in leap years), limited
 * to the programme window exactly like the overview's year grid.
 */
export function buildYearFlipMonths(
	year: number,
	window: CalendarCycleWindow,
): FlipMonthEntry[] {
	return visibleCalendarMonths(year, window).map((month) => {
		const ref = { year, month };
		return {
			ref,
			semanticName: getMonthName(year, month),
			cells: buildVisibleCalendarMonth(year, month, window),
		};
	});
}

/**
 * Ordered month sheets of a full study cycle, from the month holding its
 * first day through the month holding its last — boundary months stay whole
 * and rely on the caller's dimming rule for out-of-cycle days, exactly like
 * the overview grid. Days outside the programme window arrive pre-masked
 * (`status:"none"`) from buildVisibleCalendarMonth.
 */
export function buildCycleFlipMonths(
	cycleNumber: number,
	window: CalendarCycleWindow,
): FlipMonthEntry[] {
	const cycle = getCycle(cycleNumber);
	const endRef: MonthRef = {
		year: cycle.end.year,
		month: cycle.end.getUniformMonth(),
	};
	const entries: FlipMonthEntry[] = [];
	let ref = getCycleStartMonth(cycle);
	for (
		let guard = 0;
		guard < 60 && compareMonths(ref, endRef) <= 0;
		guard += 1
	) {
		entries.push({
			ref,
			semanticName: `${getMonthName(ref.year, ref.month)} ${getYearLabel(ref.year)}`,
			cells: buildVisibleCalendarMonth(ref.year, ref.month, window),
		});
		ref = nextMonth(ref);
	}
	return entries;
}

/** Position of `ref` inside `months`, or -1 when the book has no such month. */
export function flipMonthPosition(
	months: FlipMonthEntry[],
	ref: MonthRef,
): number {
	return months.findIndex((entry) => compareMonths(entry.ref, ref) === 0);
}

/** Page index of `ref` inside the book, or -1 when absent. */
export function flipPageIndexForMonth(
	months: FlipMonthEntry[],
	ref: MonthRef,
): number {
	const position = flipMonthPosition(months, ref);
	return position < 0 ? -1 : flipMonthPageIndex(position);
}

/**
 * MonthRef shown on a book page index, or null for chrome faces. Both faces
 * of a month pair resolve to the same month: the readable sheet at
 * `flipMonthPageIndex(position)` and the card back at `+1`.
 */
export function flipMonthAtPageIndex(
	months: FlipMonthEntry[],
	pageIndex: number,
): MonthRef | null {
	const position = Math.floor((pageIndex - FLIP_MONTH_PAGE_OFFSET) / 2);
	return position >= 0 && position < months.length
		? months[position].ref
		: null;
}

/**
 * Nearest month inside the book for `ref`: the exact month, else the closest
 * earlier month, else the first month — used when the requested period lies
 * outside the displayed scope (e.g. a cycle boundary).
 */
export function clampMonthToFlipScope(
	months: FlipMonthEntry[],
	ref: MonthRef,
): MonthRef {
	const exact = flipMonthPosition(months, ref);
	if (exact >= 0) {
		return months[exact].ref;
	}
	let candidate: MonthRef | null = null;
	for (const entry of months) {
		if (compareMonths(entry.ref, ref) < 0) {
			candidate = entry.ref;
		} else {
			break;
		}
	}
	/* istanbul ignore next: books always hold at least one month */
	return candidate ?? months[0].ref;
}

/**
 * `initialTurnedLeaves` reproducing the engine's `jumpToPage` leaf math, so a
 * freshly mounted book opens on the spread containing `pageIndex` without an
 * animated flip-through.
 */
export function initialTurnedLeavesForPage(
	pageIndex: number,
	pagesCount: number,
): number[] {
	if (pageIndex <= 0) {
		return [];
	}
	const leafCount = Math.ceil(pagesCount / 2);
	const lastLeaf =
		pageIndex === pagesCount - 1 && pageIndex % 2 === 1
			? leafCount - 1
			: Math.floor((pageIndex - 1) / 2);
	return Array.from({ length: lastLeaf + 1 }, (_, index) => index);
}

const CHROME_TITLES = [
	"עטיפה קדמית",
	"",
	"לוח לימוד יומי",
] as const;

/**
 * True only for the readable sheet face of each month pair; the companion
 * card-back face right after it reports empty semantics, so the page
 * indicator and jump control always target the readable face.
 */
function isMonthSheetPage(pageIndex: number, monthCount: number): boolean {
	return (
		pageIndex >= FLIP_MONTH_PAGE_OFFSET &&
		pageIndex < FLIP_MONTH_PAGE_OFFSET + monthCount * 2 &&
		(pageIndex - FLIP_MONTH_PAGE_OFFSET) % 2 === 0
	);
}

/**
 * Page semantics for the toolbar indicator/jump and engine page metadata.
 * Chrome and card-back faces report empty semantic names so the indicator
 * falls back to the neighbouring month label.
 */
export function buildFlipPageSemantics(
	months: FlipMonthEntry[],
	pagesCount: number,
): PageSemantics {
	const nameToPage = new Map<string, number>();
	months.forEach((entry, position) => {
		if (!nameToPage.has(entry.semanticName)) {
			nameToPage.set(entry.semanticName, flipMonthPageIndex(position));
		}
	});
	return {
		indexToSemanticName: (pageIndex) =>
			isMonthSheetPage(pageIndex, months.length)
				? months[(pageIndex - FLIP_MONTH_PAGE_OFFSET) / 2].semanticName
				: "",
		semanticNameToIndex: (semanticName) => nameToPage.get(semanticName) ?? null,
		indexToTitle: (pageIndex) => {
			if (isMonthSheetPage(pageIndex, months.length)) {
				return getMonthLabel(
					months[(pageIndex - FLIP_MONTH_PAGE_OFFSET) / 2].ref,
				);
			}
			if (pageIndex === pagesCount - 2) {
				return "";
			}
			if (pageIndex === pagesCount - 1) {
				return "עטיפה אחורית";
			}
			return CHROME_TITLES[pageIndex] ?? "";
		},
	};
}
