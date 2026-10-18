/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";

jest.mock("next/navigation", () => ({
	useRouter: jest.fn(),
	useSearchParams: jest.fn(),
}));

import { LearningCalendar } from "@/app/calendar/components/LearningCalendar";
import {
	getCycle,
	getCycleStartMonth,
	nextMonth,
} from "@/data/learning-schedule";

const mockReplace = jest.fn();
const mockPush = jest.fn();

function setSearchParam(value: string | null) {
	const params = new URLSearchParams();
	if (value !== null) {
		params.set("month", value);
	}
	(useSearchParams as jest.Mock).mockReturnValue(params);
}

const cycleStartProps = {
	initialYear: 5785,
	initialMonth: 12,
	todayDateNumber: 57851207,
};

describe("LearningCalendar", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(useRouter as jest.Mock).mockReturnValue({
			replace: mockReplace,
			push: mockPush,
		});
		setSearchParam(null);
	});

	it("renders the current Hebrew month with study and review days", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		expect(
			screen.getByRole("heading", { name: "לוח לימוד יומי" }),
		).toBeInTheDocument();
		// אלול ה'תשפ"ה
		expect(
			screen.getByRole("heading", { name: /אלול ה'תשפ/ }),
		).toBeInTheDocument();
		// Cycle 4 starts ז אלול with בראשית א (perek 1).
		expect(
			screen.getByRole("button", { name: (name) =>
				/אלול.*בראשית א/.test(name) && !name.includes("חזרה") }),
		).toBeInTheDocument();
		// 12-13 Elul (Friday/Saturday) review the whole studied week (#2365).
		const reviewDays = screen.getAllByRole("button", { name: /חזרה/ });
		expect(reviewDays.length).toBeGreaterThanOrEqual(2);
		expect(reviewDays[0]).toHaveAccessibleName(/חזרה: בראשית א - בראשית ה/);
	});

	it("navigates to the next month and syncs the ?month= query", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));

		expect(mockReplace).toHaveBeenCalledWith("?month=578601", {
			scroll: false,
		});
		expect(
			screen.getByRole("heading", { name: /תשרי ה'תשפ/ }),
		).toBeInTheDocument();
	});

	it("navigates to the previous month across a leap-year boundary", () => {
		render(
			<LearningCalendar
				initialYear={5784}
				initialMonth={14}
				todayDateNumber={57851207}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "חודש קודם" }));

		expect(mockReplace).toHaveBeenCalledWith("?month=578413", {
			scroll: false,
		});
	});

	it("restores the viewed month from the ?month= query param", () => {
		setSearchParam("577502");
		render(<LearningCalendar {...cycleStartProps} />);

		expect(
			screen.getByRole("heading", { name: /חשוון ה'תשע/ }),
		).toBeInTheDocument();
	});

	it("ignores malformed ?month= params", () => {
		setSearchParam("578513"); // Adar I does not exist in non-leap 5785
		render(<LearningCalendar {...cycleStartProps} />);

		expect(
			screen.getByRole("heading", { name: /אלול ה'תשפ/ }),
		).toBeInTheDocument();
	});

	it("opens the perek reader when a study day is clicked", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.click(
			screen.getByRole("button", { name: (name) =>
				/אלול.*בראשית א/.test(name) && !name.includes("חזרה") }),
		);
		expect(mockPush).toHaveBeenCalledWith("/929/1");
	});

	it("marks today's cell", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		const todayCell = screen.getByRole("button", {
			name: (name) =>
				/אלול.*בראשית א/.test(name) && !name.includes("חזרה"),
		});
		expect(todayCell.textContent).toContain("היום");
	});

	it("returns to today's month via the היום button", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
		fireEvent.click(screen.getByRole("button", { name: "היום" }));

		expect(mockReplace).toHaveBeenLastCalledWith("?month=578512", {
			scroll: false,
		});
	});

	it("jumps to a cycle's first month via the cycle picker", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.change(
			screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
			{ target: { value: "1" } },
		);

		expect(mockReplace).toHaveBeenCalledWith("?month=577503", {
			scroll: false,
		});
	});

	it("follows ?month= changes while mounted (back/forward navigation)", () => {
		const { rerender } = render(<LearningCalendar {...cycleStartProps} />);
		expect(
			screen.getByRole("heading", { name: /אלול ה'תשפ/ }),
		).toBeInTheDocument();

		setSearchParam("578407");
		rerender(<LearningCalendar {...cycleStartProps} />);

		expect(
			screen.getByRole("heading", { name: /ניסן ה'תשפ"ד/ }),
		).toBeInTheDocument();
	});

	it("navigates via the month picker", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.change(screen.getByRole("combobox", { name: "חודש" }), {
			target: { value: "5" },
		});

		expect(mockReplace).toHaveBeenCalledWith("?month=578505", {
			scroll: false,
		});
		expect(
			screen.getByRole("heading", { name: /שבט ה'תשפ/ }),
		).toBeInTheDocument();
	});

	it("keeps the viewed month when picking a year where it exists", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.change(screen.getByRole("combobox", { name: "שנה" }), {
			target: { value: "5784" },
		});

		expect(mockReplace).toHaveBeenCalledWith("?month=578412", {
			scroll: false,
		});
	});

	it("falls back to Adar when picking a non-leap year while viewing Adar II", () => {
		render(
			<LearningCalendar
				initialYear={5784}
				initialMonth={14}
				todayDateNumber={57851207}
			/>,
		);

		fireEvent.change(screen.getByRole("combobox", { name: "שנה" }), {
			target: { value: "5785" },
		});

		expect(mockReplace).toHaveBeenCalledWith("?month=578506", {
			scroll: false,
		});
	});

	it("extends the cycle picker past confirmed data for a projected month", () => {
		// The month after cycle 11's start lies entirely inside the cycle, so it
		// anchors the picker on the projected cycle rather than cycle 10's tail.
		const projected = nextMonth(getCycleStartMonth(getCycle(11)));
		render(
			<LearningCalendar
				initialYear={projected.year}
				initialMonth={projected.month}
				todayDateNumber={57851207}
			/>,
		);

		const picker = screen.getByRole("combobox", {
			name: "בחירת מחזור לימוד",
		});
		expect(picker).toHaveValue("11");
		expect(
			screen.getByRole("option", { name: "מחזור 11 (משוער)" }),
		).toBeInTheDocument();
		// The projected cycle's label is shown next to the picker.
		expect(screen.getByText(/מחזור 11 \(משוער\):/)).toBeInTheDocument();
	});
});
