/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";

jest.mock("next/navigation", () => ({
	useRouter: jest.fn(),
	useSearchParams: jest.fn(),
}));

// The flip book is code-split; unit tests stub it and drive its props
// directly instead of loading the engine.
const mockFlipBookProps: {
	current: {
		months: { ref: { year: number; month: number } }[];
		initialMonth: { year: number; month: number };
		onMonthChange: (month: { year: number; month: number }) => void;
		onToday: () => void;
		onShowOverview: () => void;
		jumpRequest: { month: { year: number; month: number }; nonce: number } | null;
	} | null;
} = { current: null };

jest.mock("@/app/calendar/components/CalendarFlipBook", () => {
	const React = jest.requireActual<typeof import("react")>("react");
	return {
		CalendarFlipBook: (props: typeof mockFlipBookProps.current) => {
			mockFlipBookProps.current = props;
			return React.createElement("div", {
				"data-testid": "calendar-flip-book",
				"data-month-count": props?.months.length ?? 0,
			});
		},
	};
});

import { LearningCalendar } from "@/app/calendar/components/LearningCalendar";
import {
	getCycle,
	getCycleStartMonth,
	nextMonth,
} from "@/data/learning-schedule";

// Search params behave like real Next.js navigation: router.replace/push
// with a "?..." URL updates what useSearchParams returns on the next render.
let currentSearchParams = new URLSearchParams();

function applySearchParams(url: string) {
	if (!url.startsWith("?")) {
		return;
	}
	currentSearchParams = new URLSearchParams(url.slice(1));
	(useSearchParams as jest.Mock).mockReturnValue(currentSearchParams);
}

const mockReplace = jest.fn((url: string) => applySearchParams(url));
const mockPush = jest.fn((url: string) => applySearchParams(url));

function setSearchParam(value: string | null, extra?: Record<string, string>) {
	const params = new URLSearchParams();
	if (value !== null) {
		params.set("month", value);
	}
	for (const [key, val] of Object.entries(extra ?? {})) {
		params.set(key, val);
	}
	currentSearchParams = params;
	(useSearchParams as jest.Mock).mockReturnValue(params);
}

function q(container: HTMLElement, selector: string): Element {
	const el = container.querySelector(selector);
	if (el === null) {
		throw new Error(`Missing element: ${selector}`);
	}
	return el;
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
			screen.getByRole("button", {
				name: (name) => /אלול.*בראשית א/.test(name) && !name.includes("חזרה"),
			}),
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
			screen.getByRole("button", {
				name: (name) => /אלול.*בראשית א/.test(name) && !name.includes("חזרה"),
			}),
		);
		expect(mockPush).toHaveBeenCalledWith("/929/1");
	});

	it("marks today's cell", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		const todayCell = screen.getByRole("button", {
			name: (name) => /אלול.*בראשית א/.test(name) && !name.includes("חזרה"),
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

	describe("view modes", () => {
		it("renders a view toggle with monthly/yearly/full-cycle options", () => {
			render(<LearningCalendar {...cycleStartProps} />);

			expect(screen.getByRole("button", { name: "חודשי" })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			expect(screen.getByRole("button", { name: "שנתי" })).toHaveAttribute(
				"aria-pressed",
				"false",
			);
			expect(screen.getByRole("button", { name: "מחזור מלא" })).toHaveAttribute(
				"aria-pressed",
				"false",
			);
		});

		it("switches to the yearly view and syncs the ?view= query", () => {
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.click(screen.getByRole("button", { name: "שנתי" }));

			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("view=year"),
				{ scroll: false },
			);
			// Every month of תשפ"ה appears as a mini-month section.
			const headings = [...container.querySelectorAll("h3")].map(
				(h) => h.textContent,
			);
			for (const name of ["תשרי", "חשוון", "אלול"]) {
				expect(headings).toContain(name);
			}
		});

		it("renders the yearly view from the ?view=year query", () => {
			setSearchParam("578512", { view: "year" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			expect(
				container.querySelector('button[aria-pressed="true"]')?.textContent,
			).toBe("שנתי");
			expect(container.querySelector("h2")?.textContent).toMatch(/שנת ה'תשפ/);
			// Study days stay navigable inside mini-months.
			expect(
				container.querySelectorAll('button[aria-label*="חזרה"]').length,
			).toBeGreaterThanOrEqual(2);
		});

		it("switches to the full-cycle view and renders its months", () => {
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.click(screen.getByRole("button", { name: "מחזור מלא" }));

			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("view=cycle"),
				{ scroll: false },
			);
			// אלול 5785 belongs to cycle 4; the heading shows the full range.
			expect(container.querySelector("h2")?.textContent).toMatch(/מחזור 4/);
			expect(container.querySelectorAll("h3").length).toBeGreaterThan(30);
		});

		it("navigates to the next cycle in full-cycle view", () => {
			setSearchParam("578512", { view: "cycle", cycle: "4" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.click(q(container, 'button[aria-label="מחזור הבא"]'));

			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("cycle=5"),
				{ scroll: false },
			);
			expect(container.querySelector("h2")?.textContent).toMatch(/מחזור 5/);
		});

		it("navigates to the next year in yearly view", () => {
			setSearchParam("578512", { view: "year" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.click(q(container, 'button[aria-label="שנה הבאה"]'));

			// אלול exists in every year, so the month is preserved.
			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("month=578612"),
				{ scroll: false },
			);
		});

		it("jumps between cycles via the cycle picker in full-cycle view", () => {
			setSearchParam("578512", { view: "cycle", cycle: "4" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.change(q(container, 'select[aria-label="בחירת מחזור לימוד"]'), {
				target: { value: "2" },
			});

			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("cycle=2"),
				{ scroll: false },
			);
			expect(container.querySelector("h2")?.textContent).toMatch(/מחזור 2/);
		});

		it("disables previous-cycle navigation on the first cycle", () => {
			setSearchParam("578512", { view: "cycle", cycle: "1" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			expect(
				container.querySelector('button[aria-label="מחזור קודם"]'),
			).toBeDisabled();
		});

		it("keeps scheduled perakim navigable in yearly view", () => {
			setSearchParam("578512", { view: "year" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			const studyDay = [
				...container.querySelectorAll('button[aria-label*="בראשית א"]'),
			].find((b) => !b.getAttribute("aria-label")?.includes("חזרה"));
			expect(studyDay).toBeDefined();
			fireEvent.click(studyDay as Element);

			expect(mockPush).toHaveBeenCalledWith("/929/1");
		});
	});

	describe("PDF download action (#2621)", () => {
		beforeEach(() => {
			global.fetch = jest.fn();
			URL.createObjectURL = jest.fn(() => "blob:mock");
			URL.revokeObjectURL = jest.fn();
		});

		it("names the selected month on the download action", () => {
			render(<LearningCalendar {...cycleStartProps} />);

			expect(
				screen.getByRole("button", {
					name: /הורדת PDF: אלול ה'תשפ/,
				}),
			).toBeInTheDocument();
		});

		it("names the selected year in yearly view", () => {
			setSearchParam("578512", { view: "year" });
			render(<LearningCalendar {...cycleStartProps} />);

			expect(
				screen.getByRole("button", { name: /הורדת PDF: שנת ה'תשפ/ }),
			).toBeInTheDocument();
		});

		it("names the selected cycle in full-cycle view", () => {
			setSearchParam("578512", { view: "cycle", cycle: "4" });
			render(<LearningCalendar {...cycleStartProps} />);

			expect(
				screen.getByRole("button", { name: /הורדת PDF: מחזור 4/ }),
			).toBeInTheDocument();
		});

		it("fetches nothing while the calendar is browsed", () => {
			render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
			fireEvent.click(screen.getByRole("button", { name: "שנתי" }));

			expect(global.fetch).not.toHaveBeenCalled();
		});
	});

	describe("flipping presentation (#2993)", () => {
		beforeEach(() => {
			localStorage.clear();
			mockFlipBookProps.current = null;
		});

		it("shows the presentation toggle only in year and cycle views", async () => {
			render(<LearningCalendar {...cycleStartProps} />);

			// Monthly view has no flipping presentation.
			expect(
				screen.queryByRole("button", { name: "דפדוף" }),
			).not.toBeInTheDocument();

			fireEvent.click(screen.getByRole("button", { name: "שנתי" }));
			expect(
				await screen.findByRole("button", { name: "דפדוף" }),
			).toBeInTheDocument();
			expect(screen.getByRole("button", { name: "סקירה" })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			expect(screen.getByRole("button", { name: "דפדוף" })).toHaveAttribute(
				"aria-pressed",
				"false",
			);
		});

		it("lazy-loads the flip book with one sheet per month of the year", async () => {
			setSearchParam("578512", { view: "year", flip: "1" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			const book = await screen.findByTestId("calendar-flip-book");
			expect(book).toHaveAttribute("data-month-count", "12");
			// The book opens on the month carried by ?month=.
			expect(mockFlipBookProps.current?.initialMonth).toEqual({
				year: 5785,
				month: 12,
			});
			// The overview mini-month grid is not rendered alongside.
			expect(container.querySelectorAll("h3")).toHaveLength(0);
		});

		it("renders a sheet per month of a full cycle", async () => {
			setSearchParam("578512", { view: "cycle", cycle: "4", flip: "1" });
			render(<LearningCalendar {...cycleStartProps} />);

			const book = await screen.findByTestId("calendar-flip-book");
			const count = Number(book.getAttribute("data-month-count"));
			expect(count).toBeGreaterThan(30);
			// Chronological coverage: first sheet is the cycle's first month.
			expect(mockFlipBookProps.current?.months[0].ref).toEqual(
				getCycleStartMonth(getCycle(4)),
			);
			expect(
				mockFlipBookProps.current?.months[count - 1].ref,
			).toBeDefined();
		});

		it("writes the flipped month back to ?month= without losing flip=1", async () => {
			setSearchParam("578512", { view: "year", flip: "1" });
			render(<LearningCalendar {...cycleStartProps} />);
			await screen.findByTestId("calendar-flip-book");

			act(() => {
				mockFlipBookProps.current?.onMonthChange({
					year: 5785,
					month: 7,
				});
			});

			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("month=578507"),
				{ scroll: false },
			);
			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("flip=1"),
				{ scroll: false },
			);
		});

		it("returns to the overview and clears the flip param", async () => {
			setSearchParam("578512", { view: "year", flip: "1" });
			const { container, rerender } = render(
				<LearningCalendar {...cycleStartProps} />,
			);
			await screen.findByTestId("calendar-flip-book");

			fireEvent.click(screen.getByRole("button", { name: "סקירה" }));
			// router.replace updates the URL; Next.js then re-renders with the
			// new searchParams — simulate that propagation here.
			rerender(<LearningCalendar {...cycleStartProps} />);

			expect(screen.queryByTestId("calendar-flip-book")).not.toBeInTheDocument();
			expect(mockReplace).toHaveBeenCalledWith(
				expect.not.stringContaining("flip="),
				{ scroll: false },
			);
			expect(localStorage.getItem("calendarFlipView")).toBe("overview");
			expect(container.querySelectorAll("h3").length).toBeGreaterThan(0);
		});

		it("persists the flipping preference across visits", async () => {
			localStorage.setItem("calendarFlipView", "flip");
			setSearchParam("578512", { view: "year" });
			render(<LearningCalendar {...cycleStartProps} />);

			expect(
				await screen.findByTestId("calendar-flip-book"),
			).toBeInTheDocument();
		});

		it("pins the resolved cycle into the URL when flipping without ?cycle=", async () => {
			setSearchParam("578512", { view: "cycle", flip: "1" });
			render(<LearningCalendar {...cycleStartProps} />);
			await screen.findByTestId("calendar-flip-book");

			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("cycle=4"),
				{ scroll: false },
			);
		});

		it("jumps the book to today's month via the toolbar היום action", async () => {
			setSearchParam("578512", { view: "year", flip: "1" });
			render(<LearningCalendar {...cycleStartProps} />);
			await screen.findByTestId("calendar-flip-book");

			act(() => {
				mockFlipBookProps.current?.onToday();
			});

			// todayDateNumber 57851207 → אלול ה'תשפ"ה, already inside the book.
			expect(mockFlipBookProps.current?.jumpRequest).toMatchObject({
				month: { year: 5785, month: 12 },
				nonce: 1,
			});
		});

		it("keeps the overview when ?flip=1 is combined with the monthly view", () => {
			setSearchParam("578512", { view: "month", flip: "1" });
			render(<LearningCalendar {...cycleStartProps} />);

			expect(
				screen.queryByTestId("calendar-flip-book"),
			).not.toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: "דפדוף" }),
			).not.toBeInTheDocument();
		});
	});
});
