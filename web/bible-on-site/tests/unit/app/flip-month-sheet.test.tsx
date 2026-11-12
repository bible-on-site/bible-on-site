/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import {
	FlipMonthSheet,
	FlipMonthSheetBack,
} from "@/app/calendar/components/FlipMonthSheet";
import type { FlipMonthEntry } from "@/app/calendar/components/flip-month-data";
import type { CalendarDay, MonthCell } from "@/data/learning-schedule";

function makeDay(overrides: Partial<CalendarDay>): CalendarDay {
	return {
		date: {},
		dateNumber: 57850100 + (overrides.day ?? 1),
		day: 1,
		dayOfWeek: 0,
		status: "study",
		...overrides,
	} as CalendarDay;
}

function makeEntry(cells: MonthCell[]): FlipMonthEntry {
	return {
		ref: { year: 5785, month: 1 },
		semanticName: "תשרי",
		cells,
	};
}

const noop = () => {};
const ariaFor = (day: CalendarDay) => `יום ${day.dateNumber}`;
const mergedAriaFor = (friday: CalendarDay, shabbat: CalendarDay) =>
	`מזוג ${friday.dateNumber}-${shabbat.dateNumber}`;

function renderSheet(
	cells: MonthCell[],
	extra?: {
		todayDateNumber?: number;
		isDimmed?: (day: CalendarDay) => boolean;
		onOpen?: (perekId: number) => void;
	},
) {
	return render(
		<FlipMonthSheet
			entry={makeEntry(cells)}
			todayDateNumber={extra?.todayDateNumber ?? -1}
			onOpen={extra?.onOpen ?? noop}
			dayAriaLabel={ariaFor}
			mergedDayAriaLabel={mergedAriaFor}
			isDimmed={extra?.isDimmed}
		/>,
	);
}

describe("FlipMonthSheet", () => {
	it("renders the month title, weekday headers and study-day buttons", () => {
		const studyDay = makeDay({ day: 3, perekId: 1 });
		renderSheet([{ day: studyDay }]);
		expect(
			screen.getByRole("heading", { name: "תשרי ה'תשפ\"ה" }),
		).toBeInTheDocument();
		const button = screen.getByRole("button", { name: ariaFor(studyDay) });
		expect(button).toHaveTextContent("בראשית א");
	});

	it("opens the perek when a study cell is clicked", () => {
		const onOpen = jest.fn();
		const studyDay = makeDay({ day: 4, perekId: 5 });
		renderSheet([{ day: studyDay }], { onOpen });
		fireEvent.click(screen.getByRole("button", { name: ariaFor(studyDay) }));
		expect(onOpen).toHaveBeenCalledWith(5);
	});

	it("marks review days with the review badge and range label", () => {
		const reviewDay = makeDay({
			day: 6,
			dayOfWeek: 6,
			status: "review",
			perekId: 3,
			reviewPerekIds: [1, 2, 3],
		});
		renderSheet([{ day: reviewDay }]);
		const button = screen.getByRole("button", { name: ariaFor(reviewDay) });
		expect(button).toHaveTextContent("חזרה");
		expect(button).toHaveTextContent("בראשית א-ג");
	});

	it("renders unscheduled days as non-interactive cells without a label", () => {
		const freeDay = makeDay({ day: 7, status: "none" });
		renderSheet([{ day: freeDay }]);
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("spans a merged Friday-Saturday review pair over two columns", () => {
		const ids = [10, 11, 12];
		const friday = makeDay({
			day: 5,
			dayOfWeek: 5,
			status: "review",
			perekId: 12,
			reviewPerekIds: ids,
			cycle: 4,
		});
		const shabbat = makeDay({
			day: 6,
			dayOfWeek: 6,
			status: "review",
			perekId: 12,
			reviewPerekIds: ids,
			cycle: 4,
		});
		renderSheet([{ day: friday }, { day: shabbat }]);
		const merged = screen.getByRole("button", {
			name: mergedAriaFor(friday, shabbat),
		});
		expect(merged).toHaveClass("cal-cell--merged");
		// The Saturday cell is swallowed by Friday's spanning block.
		expect(
			screen.queryByRole("button", { name: ariaFor(shabbat) }),
		).not.toBeInTheDocument();
	});

	it("renders leading and trailing blank cells as inert", () => {
		const cells: MonthCell[] = [
			{ blankColumn: 0 },
			{ blankColumn: 1 },
			{ day: makeDay({ day: 1, perekId: 1 }) },
		];
		const { container } = renderSheet(cells);
		const blanks = container.querySelectorAll(".cal-cell--blank");
		// Two leading blanks plus the trailing blanks padding the last week.
		expect(blanks.length).toBeGreaterThan(2);
	});

	it("marks the current day and a merged pair containing it", () => {
		const ids = [20, 21];
		const friday = makeDay({
			day: 12,
			dayOfWeek: 5,
			status: "review",
			perekId: 21,
			reviewPerekIds: ids,
			cycle: 4,
		});
		const shabbat = makeDay({
			day: 13,
			dayOfWeek: 6,
			status: "review",
			perekId: 21,
			reviewPerekIds: ids,
			cycle: 4,
		});
		renderSheet([{ day: friday }, { day: shabbat }], {
			todayDateNumber: shabbat.dateNumber,
		});
		const merged = screen.getByRole("button", {
			name: mergedAriaFor(friday, shabbat),
		});
		expect(merged).toHaveClass("cal-cell--today");
		expect(merged).toHaveTextContent("היום");
	});

	it("dims out-of-cycle days and keeps them inert", () => {
		const outside = makeDay({ day: 8, perekId: 7, cycle: 3 });
		renderSheet([{ day: outside }], {
			isDimmed: (day) => day.cycle === 3,
		});
		const cell = screen.getByText(ariaFor(outside), { selector: "span" });
		expect(cell.closest("div")).toHaveClass("cal-cell--dimmed");
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});
});

describe("FlipMonthSheetBack", () => {
	it("renders a decorative card back carrying the month caption", () => {
		const { container } = render(
			<FlipMonthSheetBack entry={makeEntry([])} />,
		);
		const back = container.querySelector(".cal-sheet-back");
		expect(back).toHaveAttribute("aria-hidden", "true");
		expect(back).toHaveTextContent("תשרי ה'תשפ\"ה");
	});
});
