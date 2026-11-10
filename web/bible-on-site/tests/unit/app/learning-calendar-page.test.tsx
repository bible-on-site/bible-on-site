/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";

jest.mock("next/navigation", () => ({
	useRouter: jest.fn(),
	useSearchParams: jest.fn(),
}));

// The flip book is code-split; unit tests stub it and drive its props
// directly instead of loading the engine.
const mockFlipBookProps: {
	current: {
		months: {
			ref: { year: number; month: number };
			cells: unknown[];
		}[];
		initialMonth: { year: number; month: number };
		onMonthChange: (month: { year: number; month: number }) => void;
		onToday: () => void;
		onShowOverview: () => void;
		jumpRequest: {
			month: { year: number; month: number };
			nonce: number;
		} | null;
		isDimmed?: (day: unknown) => boolean;
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
	buildMonth,
	getCycle,
	getCycleStartMonth,
	getDateLabel,
	getDaySourceLabel,
	getMonthOrder,
	nextMonth,
} from "@/data/learning-schedule";

const mockReplace = jest.fn();
const mockPush = jest.fn();

function setSearchParam(value: string | null, extra?: Record<string, string>) {
	const params = new URLSearchParams();
	if (value !== null) {
		params.set("month", value);
	}
	for (const [key, val] of Object.entries(extra ?? {})) {
		params.set(key, val);
	}
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
		mockFlipBookProps.current = null;
		window.localStorage.clear();
		// jsdom lacks rAF unless pretendToBeVisual is on; focus restore in
		// the flip toolbar path needs a synchronous stub.
		window.requestAnimationFrame = (callback: FrameRequestCallback) => {
			callback(0);
			return 0;
		};
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
		// 12-13 Elul (Friday/Saturday) review the whole studied week (#2365):
		// one merged block covering both dates, not two duplicate cells.
		const reviewDays = screen.getAllByRole("button", { name: /חזרה/ });
		expect(reviewDays.length).toBeGreaterThanOrEqual(1);
		const merged = screen.getByRole("button", {
			name: /י"ב אלול.*י"ג אלול.*חזרה: בראשית א-ה/,
		});
		expect(merged).toBeInTheDocument();
		expect(merged.textContent).toContain('י"ב');
		expect(merged.textContent).toContain('י"ג');
		// Saturday's cell is folded into Friday's block, not rendered alone.
		expect(
			screen.queryByRole("button", { name: /^י"ג אלול/ }),
		).not.toBeInTheDocument();
	});

	it("merges Friday/Saturday review cells in the yearly view", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.click(screen.getByRole("button", { name: "שנתי" }));

		// אלול's mini-month shows the merged 12-13 pair as one block (#2365).
		const merged = screen.getAllByRole("button", {
			name: /י"ב אלול.*י"ג אלול.*חזרה: בראשית א-ה/,
		});
		expect(merged.length).toBe(1);
		expect(merged[0].textContent).toContain('י"ב');
		expect(merged[0].textContent).toContain('י"ג');
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

	it("keeps rapid next/previous navigation while the URL replacement is pending", () => {
		// Next exposes the old URL until navigation commits; wrapper identity
		// must not turn that unchanged URL into a new month selection.
		(useSearchParams as jest.Mock).mockImplementation(
			() => new URLSearchParams({ month: "578703" }),
		);
		const { rerender } = render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
		expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("4");
		rerender(<LearningCalendar {...cycleStartProps} />);
		expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("4");

		fireEvent.click(screen.getByRole("button", { name: "חודש קודם" }));
		expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("3");
		expect(mockReplace.mock.calls.map(([url]) => url)).toEqual([
			"?month=578704",
			"?month=578703",
		]);
	});

	it.each([
		{
			view: "year",
			select: "שנתי",
			next: "שנה הבאה",
			month: "578612",
			cycle: null,
		},
		{
			view: "cycle",
			select: "מחזור מלא",
			next: "מחזור הבא",
			month: "578512",
			cycle: "5",
		},
	])(
		"composes a pending $view view with navigation",
		({ view, select, next, month, cycle }) => {
			(useSearchParams as jest.Mock).mockImplementation(
				() => new URLSearchParams({ month: "578512", campaign: "keep" }),
			);
			render(<LearningCalendar {...cycleStartProps} />);
			fireEvent.click(screen.getByRole("button", { name: select }));
			fireEvent.click(screen.getByRole("button", { name: next }));

			const params = new URLSearchParams(mockReplace.mock.lastCall[0].slice(1));
			expect(params.get("view")).toBe(view);
			expect(params.get("month")).toBe(month);
			expect(params.get("cycle")).toBe(cycle);
			expect(params.get("campaign")).toBe("keep");
		},
	);

	it("composes every pending calendar field without dropping unrelated query keys", () => {
		(useSearchParams as jest.Mock).mockImplementation(
			() =>
				new URLSearchParams({ month: "578512", cycle: "4", campaign: "keep" }),
		);
		render(<LearningCalendar {...cycleStartProps} />);
		for (const name of [
			"חודש הבא",
			"שנתי",
			"שנה הבאה",
			"מחזור מלא",
			"מחזור הבא",
		]) {
			fireEvent.click(screen.getByRole("button", { name }));
		}

		const params = new URLSearchParams(mockReplace.mock.lastCall[0].slice(1));
		expect(Object.fromEntries(params)).toEqual({
			month: "578701",
			cycle: "5",
			campaign: "keep",
			view: "cycle",
		});
	});

	it.each(["שנתי", "מחזור מלא"])(
		"external query changes replace the pending %s view with URL defaults",
		(view) => {
			let query = "month=578512&campaign=keep";
			(useSearchParams as jest.Mock).mockImplementation(
				() => new URLSearchParams(query),
			);
			const { rerender } = render(<LearningCalendar {...cycleStartProps} />);
			fireEvent.click(screen.getByRole("button", { name: view }));
			if (view === "מחזור מלא") {
				fireEvent.click(screen.getByRole("button", { name: "מחזור הבא" }));
				expect(
					screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
				).toHaveValue("5");
			}

			query = "month=578601&campaign=external";
			rerender(<LearningCalendar {...cycleStartProps} />);
			expect(screen.getByRole("button", { name: "חודשי" })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("1");
			expect(
				screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
			).toHaveValue("4");
			fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
			let params = new URLSearchParams(mockReplace.mock.lastCall[0].slice(1));
			expect(Object.fromEntries(params)).toEqual({
				month: "578602",
				campaign: "external",
			});

			query = "month=578512&campaign=keep";
			rerender(<LearningCalendar {...cycleStartProps} />);
			fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
			params = new URLSearchParams(mockReplace.mock.lastCall[0].slice(1));
			expect(Object.fromEntries(params)).toEqual({
				month: "578601",
				campaign: "keep",
			});
		},
	);

	it("an external month restores the implicit cycle while keeping the URL's cycle view", () => {
		let query = "month=578512&view=cycle";
		(useSearchParams as jest.Mock).mockImplementation(
			() => new URLSearchParams(query),
		);
		const { rerender } = render(<LearningCalendar {...cycleStartProps} />);
		fireEvent.click(screen.getByRole("button", { name: "מחזור הבא" }));
		expect(
			screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
		).toHaveValue("5");

		query = "month=578601&view=cycle";
		rerender(<LearningCalendar {...cycleStartProps} />);
		expect(screen.getByRole("button", { name: "מחזור מלא" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(
			screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
		).toHaveValue("4");
	});

	it("accepts external URL changes and back/forward navigation after a pending local change", () => {
		let month = "578703";
		(useSearchParams as jest.Mock).mockImplementation(
			() => new URLSearchParams({ month }),
		);
		const { rerender } = render(<LearningCalendar {...cycleStartProps} />);
		fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));

		for (const target of ["578705", "578703", "578705"]) {
			month = target;
			rerender(<LearningCalendar {...cycleStartProps} />);
			expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue(
				String(Number(target.slice(4))),
			);
		}
		expect(mockReplace).toHaveBeenCalledTimes(1);
	});

	it("keeps default-month navigation when search params have no month", () => {
		(useSearchParams as jest.Mock).mockImplementation(
			() => new URLSearchParams(),
		);
		const { rerender } = render(<LearningCalendar {...cycleStartProps} />);
		fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
		rerender(<LearningCalendar {...cycleStartProps} />);
		expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("1");
		expect(screen.getByRole("combobox", { name: "שנה" })).toHaveValue("5786");
	});

	it("returns to the current initial month when an external URL removes month", () => {
		let month: string | null = "578703";
		(useSearchParams as jest.Mock).mockImplementation(
			() => new URLSearchParams(month === null ? {} : { month }),
		);
		const { rerender } = render(<LearningCalendar {...cycleStartProps} />);
		expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("3");

		month = null;
		rerender(<LearningCalendar {...cycleStartProps} initialMonth={11} />);
		expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("11");
		expect(screen.getByRole("combobox", { name: "שנה" })).toHaveValue("5785");
		expect(mockReplace).not.toHaveBeenCalled();
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
		setSearchParam("577504");
		render(<LearningCalendar {...cycleStartProps} />);

		expect(
			screen.getByRole("heading", { name: /טבת ה'תשע/ }),
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

	it("marks a merged review block when today is one of its dates", () => {
		// 12 Elul is the Friday half of the merged 12-13 review pair (#2365).
		render(
			<LearningCalendar {...cycleStartProps} todayDateNumber={57851212} />,
		);

		const merged = screen.getByRole("button", {
			name: /י"ב אלול.*י"ג אלול.*חזרה: בראשית א-ה/,
		});
		expect(merged.textContent).toContain("היום");
	});

	it("returns to today's month via the היום button", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
		fireEvent.click(screen.getByRole("button", { name: "היום" }));

		expect(mockReplace).toHaveBeenLastCalledWith("?month=578512&cycle=4", {
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

	it("includes projected cycles once today has reached them", () => {
		// The month after cycle 11's start lies entirely inside the cycle, so it
		// anchors the picker on the projected cycle rather than cycle 10's tail.
		const projected = nextMonth(getCycleStartMonth(getCycle(11)));
		render(
			<LearningCalendar
				initialYear={projected.year}
				initialMonth={projected.month}
				todayDateNumber={
					getCycle(11).start.year * 10000 +
					getCycle(11).start.getUniformMonth() * 100 +
					getCycle(11).start.day
				}
			/>,
		);

		const picker = screen.getByRole("combobox", {
			name: "בחירת מחזור לימוד",
		});
		expect(picker).toHaveValue("11");
		expect(
			screen.getByRole("option", { name: 'מחזור י"א (משוער)' }),
		).toBeInTheDocument();
		// The projected cycle's label is shown next to the picker.
		expect(screen.getByText(/מחזור י"א \(משוער\):/)).toBeInTheDocument();
	});

	it("navigates to the previous year while retaining the calendar query", () => {
		setSearchParam("578512", { view: "year", campaign: "keep" });
		render(<LearningCalendar {...cycleStartProps} />);
		fireEvent.click(screen.getByRole("button", { name: "שנה קודמת" }));
		expect(mockReplace).toHaveBeenLastCalledWith(
			"?month=578412&view=year&campaign=keep",
			{ scroll: false },
		);
		expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
			"ה'תשפ\"ד",
		);
	});

	it("keeps the majority cycle when the following cycle begins late in the month", () => {
		setSearchParam("580309");
		render(
			<LearningCalendar {...cycleStartProps} todayDateNumber={58030925} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "מחזור מלא" }));
		expect(
			screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
		).toHaveValue("8");
		expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
			"מחזור ח'",
		);
	});

	it("keeps pending month navigation when the live day changes inside the same window", () => {
		(useSearchParams as jest.Mock).mockImplementation(
			() => new URLSearchParams({ month: "578512", campaign: "keep" }),
		);
		const { rerender } = render(<LearningCalendar {...cycleStartProps} />);
		fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
		expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("1");
		rerender(
			<LearningCalendar {...cycleStartProps} todayDateNumber={57851208} />,
		);
		expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("1");
		expect(screen.getByRole("combobox", { name: "שנה" })).toHaveValue("5786");
	});

	it("drops pending fields when a live default-month change resets the visible selection", () => {
		(useSearchParams as jest.Mock).mockImplementation(
			() => new URLSearchParams({ campaign: "keep" }),
		);
		const { rerender } = render(<LearningCalendar {...cycleStartProps} />);
		fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
		rerender(
			<LearningCalendar
				initialYear={5786}
				initialMonth={2}
				todayDateNumber={57860201}
			/>,
		);
		expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("2");
		fireEvent.click(screen.getByRole("button", { name: "שנתי" }));
		const params = new URLSearchParams(mockReplace.mock.calls.at(-1)?.[0]);
		expect(params.get("month")).toBeNull();
		expect(params.get("campaign")).toBe("keep");
		expect(params.get("view")).toBe("year");
	});
	it("labels the full cycle's partial first and last months from their calendar months", () => {
		setSearchParam("578512", { view: "cycle", cycle: "4" });
		render(<LearningCalendar {...cycleStartProps} />);
		const headings = screen.getAllByRole("heading", { level: 3 });
		expect(headings[0]).toHaveTextContent("אלול ה'תשפ\"ה");
		expect(headings[headings.length - 1]).toHaveTextContent("ניסן ה'תשפ\"ט");
	});
	it("ignores cycle zero and uses the month-derived cycle", () => {
		setSearchParam("578512", { view: "cycle", cycle: "0" });
		render(<LearningCalendar {...cycleStartProps} />);
		expect(
			screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
		).toHaveValue("4");
		expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
			"מחזור ד'",
		);
		expect(mockReplace).not.toHaveBeenCalled();
	});

	it("navigates to the previous cycle while retaining the committed query", () => {
		setSearchParam("578512", { view: "cycle", cycle: "4", campaign: "keep" });
		render(<LearningCalendar {...cycleStartProps} />);
		fireEvent.click(screen.getByRole("button", { name: "מחזור קודם" }));
		expect(mockReplace).toHaveBeenLastCalledWith(
			"?month=578512&view=cycle&cycle=3&campaign=keep",
			{ scroll: false },
		);
		expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
			"מחזור ג'",
		);
		expect(
			screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
		).toHaveValue("3");
	});

	it("uses today's cycle when browsing a month before the programme started", () => {
		setSearchParam("577501");
		render(<LearningCalendar {...cycleStartProps} />);
		const picker = screen.getByRole("combobox", { name: "בחירת מחזור לימוד" });
		expect(picker).toHaveValue("");
		expect(screen.getByRole("option", { name: "-" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "מחזור מלא" }));
		expect(picker).toHaveValue("4");
		expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
			"מחזור ד'",
		);
	});

	it("uses the first cycle and returns to today before any cycle has started", () => {
		setSearchParam("577501");
		render(
			<LearningCalendar {...cycleStartProps} todayDateNumber={57750101} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "מחזור מלא" }));
		expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
			"מחזור א'",
		);
		fireEvent.click(screen.getByRole("button", { name: "היום" }));
		expect(mockReplace).toHaveBeenLastCalledWith(
			"?month=577501&view=cycle&cycle=1",
			{ scroll: false },
		);
		expect(
			screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
		).toHaveValue("1");
	});
	describe("view modes", () => {
		it("limits shared links, pickers and navigation to the cycle after today's", () => {
			setSearchParam("590001", { view: "cycle", cycle: "999" });
			render(<LearningCalendar {...cycleStartProps} />);
			const picker = screen.getByRole("combobox", {
				name: "בחירת מחזור לימוד",
			});
			expect(picker).toHaveValue("5");
			expect(picker.querySelectorAll("option")).toHaveLength(5);
			expect(screen.getByRole("button", { name: "מחזור הבא" })).toBeDisabled();
			expect(screen.getByRole("button", { name: /הורדת PDF/ })).toBeDisabled();
			fireEvent.click(screen.getByRole("button", { name: "היום" }));
			expect(picker).toHaveValue("4");
			expect(screen.getByRole("button", { name: /הורדת PDF/ })).toBeEnabled();
		});

		it("keeps history readable while blocking its export", () => {
			setSearchParam("578301", { view: "cycle", cycle: "3" });
			render(<LearningCalendar {...cycleStartProps} />);
			expect(
				screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
			).toHaveValue("3");
			expect(screen.getByRole("button", { name: /הורדת PDF/ })).toBeDisabled();
			expect(screen.getByRole("status")).toHaveTextContent(
				"החל משנה לפני תחילתו",
			);
		});

		it("opens the next cycle and all of its supported future years at the anniversary", () => {
			setSearchParam("579101", { view: "year" });
			const props = { ...cycleStartProps, todayDateNumber: 57880708 };
			const { rerender } = render(<LearningCalendar {...props} />);
			expect(screen.getByRole("button", { name: /הורדת PDF/ })).toBeDisabled();
			rerender(<LearningCalendar {...props} todayDateNumber={57880709} />);
			expect(screen.getByRole("button", { name: /הורדת PDF/ })).toBeEnabled();
		});

		it("ends month/year navigation at the end of the next cycle", () => {
			setSearchParam("590001");
			const { container } = render(<LearningCalendar {...cycleStartProps} />);
			expect(screen.getByRole("combobox", { name: "שנה" })).toHaveValue("5793");
			expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("2");
			expect(screen.getByRole("button", { name: "חודש הבא" })).toBeDisabled();
			fireEvent.click(screen.getByRole("button", { name: "שנתי" }));
			expect(container.querySelectorAll("h3")).toHaveLength(2);
			expect(screen.getByRole("button", { name: "שנה הבאה" })).toBeDisabled();
		});

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
			expect(container.querySelector("h2")?.textContent).toMatch(/מחזור ד'/);
			expect(container.querySelectorAll("h3").length).toBeGreaterThan(30);
		});

		it("shows a single selected-cycle description in full-cycle view (#2725)", () => {
			setSearchParam("578512", { view: "cycle", cycle: "4" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			// The h2 is the one authoritative description with the range —
			// nothing beside the picker repeats it.
			expect(container.querySelector("h2")?.textContent).toMatch(/מחזור ד':/);
			expect(screen.getAllByText(/מחזור ד':/)).toHaveLength(1);
			expect(
				screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
			).toHaveValue("4");
		});

		it("navigates to the next cycle in full-cycle view", () => {
			setSearchParam("578512", { view: "cycle", cycle: "4" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.click(q(container, 'button[aria-label="מחזור הבא"]'));

			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("cycle=5"),
				{ scroll: false },
			);
			expect(container.querySelector("h2")?.textContent).toMatch(/מחזור ה'/);
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
			expect(container.querySelector("h2")?.textContent).toMatch(/מחזור ב'/);
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

	describe("grouped views show perek sources (#2975)", () => {
		/** The MiniMonth section whose h3 title matches. */
		function miniMonth(container: HTMLElement, title: RegExp): HTMLElement {
			const section = [...container.querySelectorAll("section")].find((s) =>
				title.test(s.querySelector("h3")?.textContent ?? ""),
			);
			if (section === undefined) {
				throw new Error(`mini-month not found: ${title}`);
			}
			return section;
		}

		it.each(["year", "cycle"] as const)(
			"shows the study-day source under its date in %s view and opens that perek",
			(view) => {
				setSearchParam(
					"578512",
					view === "cycle" ? { view, cycle: "4" } : { view },
				);
				const { container } = render(
					<LearningCalendar {...cycleStartProps} />,
				);

				// י"א אלול תשפ"ה = בראשית ה (perek 5), a Thursday study day.
				// Yearly titles are plain month names; cycle titles add the year.
				const elul = miniMonth(
					container,
					view === "cycle" ? /אלול ה'תשפ"ה/ : /^אלול$/,
				);
				const cell = elul.querySelector("button[aria-label*='י\"א אלול']");
				if (cell === null) {
					throw new Error("study cell for י\"א אלול not rendered");
				}
				// The date stays; the canonical source is a visible text node,
				// not only the aria-label — jsdom renders fail this on the old
				// date-only template.
				expect(
					within(cell as HTMLElement).getByText('י"א'),
				).toBeInTheDocument();
				expect(
					within(cell as HTMLElement).getByText("בראשית ה"),
				).toBeInTheDocument();

				fireEvent.click(cell);
				expect(mockPush).toHaveBeenCalledWith("/929/5");
			},
		);

		it.each(["year", "cycle"] as const)(
			"keeps the merged review block's dates, חזרה badge and range visible in %s view",
			(view) => {
				setSearchParam(
					"578512",
					view === "cycle" ? { view, cycle: "4" } : { view },
				);
				const { container } = render(
					<LearningCalendar {...cycleStartProps} />,
				);

				const elul = miniMonth(
					container,
					view === "cycle" ? /אלול ה'תשפ"ה/ : /^אלול$/,
				);
				const merged = elul.querySelector(
					'button[aria-label*="חזרה: בראשית א-ה"]',
				);
				if (merged === null) {
					throw new Error("merged review block not rendered");
				}
				expect(
					within(merged as HTMLElement).getByText('י"ב - י"ג'),
				).toBeInTheDocument();
				expect(
					within(merged as HTMLElement).getByText("חזרה"),
				).toBeInTheDocument();
				expect(
					within(merged as HTMLElement).getByText("בראשית א-ה"),
				).toBeInTheDocument();
			},
		);

		it("shows a cross-sefer weekly review range in full in the yearly view", () => {
			// Every cycle crosses every sefer boundary; cycle 4's early years
			// hold the ויקרא/במדבר transition week, so a " - " review label
			// exists in 5786.
			let range = "";
			for (const month of getMonthOrder(5786)) {
				const hit = buildMonth(5786, month)
					.map((cell) => cell.day)
					.find(
						(d) =>
							d?.status === "review" &&
							getDaySourceLabel(d).includes(" - "),
					);
				if (hit) {
					range = getDaySourceLabel(hit);
					break;
				}
			}
			expect(range).toContain(" - ");

			setSearchParam("578609", { view: "year" });
			render(<LearningCalendar {...cycleStartProps} />);

			expect(screen.getAllByText(range).length).toBeGreaterThan(0);
		});

		it("shows sources in a leap year's Adar II mini-month", () => {
			// 5784 is a leap year; most of it lies inside cycle 3.
			const adar2 = buildMonth(5784, 14)
				.map((cell) => cell.day)
				.find((d) => d?.status === "study");
			if (adar2?.perekId === undefined) {
				throw new Error("expected a study day in Adar II 5784");
			}
			const source = getDaySourceLabel(adar2);

			setSearchParam("578414", { view: "year" });
			const { container } = render(
				<LearningCalendar {...cycleStartProps} />,
			);

			const section = miniMonth(container, /אדר ב/);
			const cells = [...section.querySelectorAll("button")].filter(
				(b) => within(b as HTMLElement).queryByText(source) !== null,
			);
			expect(cells.length).toBeGreaterThan(0);
		});

		it("keeps out-of-cycle cells date-only and non-interactive in the cycle view", () => {
			// The last months of the cycle-4 view hold cycle-5 days: dimmed and
			// rendered as plain cells (the PDF prints no label on dimmed cells).
			const nextStart = getCycle(5).start;
			const expectedLabel = `${getDateLabel(nextStart)} - בראשית א`;

			setSearchParam("578512", { view: "cycle", cycle: "4" });
			render(<LearningCalendar {...cycleStartProps} />);

			// The sr-only copy still announces the real assignment; its cell
			// must not invent a visible source for the neighbouring cycle.
			const srOnly = screen.getByText(expectedLabel);
			const cell = srOnly.parentElement;
			if (cell === null) {
				throw new Error("dimmed cell not found");
			}
			expect(cell.tagName).toBe("SPAN");
			expect(within(cell).queryByText("בראשית א")).toBeNull();
			expect(within(cell).queryByText("חזרה")).toBeNull();
		});
	});

	describe("vertical flip presentation (#2993)", () => {
		it("offers the presentation toggle only outside month view", () => {
			render(<LearningCalendar {...cycleStartProps} />);
			expect(
				screen.queryByRole("button", { name: "דפדוף" }),
			).not.toBeInTheDocument();

			setSearchParam("578609", { view: "year" });
			render(<LearningCalendar {...cycleStartProps} />);
			expect(
				screen.getByRole("button", { name: "דפדוף" }),
			).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: "סקירה" }),
			).toBeInTheDocument();
		});

		it("mounts the flip book and syncs ?flip=1 when דפדוף is selected", async () => {
			setSearchParam("578609", { view: "year" });
			render(<LearningCalendar {...cycleStartProps} />);
			expect(
				screen.queryByTestId("calendar-flip-book"),
			).not.toBeInTheDocument();

			fireEvent.click(screen.getByRole("button", { name: "דפדוף" }));

			// next/dynamic resolves the code-split book asynchronously.
			const book = await screen.findByTestId("calendar-flip-book");
			// 5786 is a regular (non-leap) year: 12 month sheets.
			expect(book).toHaveAttribute("data-month-count", "12");
			expect(mockFlipBookProps.current?.initialMonth).toEqual({
				year: 5786,
				month: 9,
			});
			expect(mockReplace).toHaveBeenCalledWith(
				"?month=578609&view=year&flip=1",
				{ scroll: false },
			);
			expect(window.localStorage.getItem("calendarFlipView")).toBe("flip");
		});

		it("honours the ?flip=1 deep link without a click", async () => {
			setSearchParam("578609", { view: "year", flip: "1" });
			render(<LearningCalendar {...cycleStartProps} />);
			expect(
				await screen.findByTestId("calendar-flip-book"),
			).toBeInTheDocument();
			// The overview grid stays unmounted while flipping.
			expect(
				document.querySelector("[class*='yearGrid']"),
			).toBeNull();
		});

		it("honours the persisted flip preference on year view", async () => {
			window.localStorage.setItem("calendarFlipView", "flip");
			setSearchParam("578609", { view: "year" });
			render(<LearningCalendar {...cycleStartProps} />);
			expect(
				await screen.findByTestId("calendar-flip-book"),
			).toBeInTheDocument();
		});

		it("ignores invalid stored preferences", async () => {
			window.localStorage.setItem("calendarFlipView", "bogus");
			setSearchParam("578609", { view: "year" });
			render(<LearningCalendar {...cycleStartProps} />);
			// Give the lazy boundary a chance to resolve, then assert absence.
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 20));
			});
			expect(
				screen.queryByTestId("calendar-flip-book"),
			).not.toBeInTheDocument();
			expect(mockFlipBookProps.current).toBeNull();
		});

		it("reports flipped months back through ?month=", async () => {
			setSearchParam("578609", { view: "year", flip: "1" });
			render(<LearningCalendar {...cycleStartProps} />);
			await screen.findByTestId("calendar-flip-book");
			mockReplace.mockClear();

			act(() => {
				mockFlipBookProps.current?.onMonthChange({
					year: 5786,
					month: 3,
				});
			});

			expect(mockReplace).toHaveBeenCalledWith(
				"?month=578603&view=year&flip=1",
				{ scroll: false },
			);
		});

		it("returns to the overview grid and drops flip=1", async () => {
			setSearchParam("578609", { view: "year", flip: "1" });
			const { container, rerender } = render(
				<LearningCalendar {...cycleStartProps} />,
			);
			await screen.findByTestId("calendar-flip-book");
			mockReplace.mockClear();

			act(() => {
				mockFlipBookProps.current?.onShowOverview();
			});

			expect(mockReplace).toHaveBeenCalledWith(
				"?month=578609&view=year",
				{ scroll: false },
			);
			expect(window.localStorage.getItem("calendarFlipView")).toBe(
				"overview",
			);
			// The mocked router does not feed the new query back; emulate the
			// committed navigation so ?flip=1 is actually gone.
			setSearchParam("578609", { view: "year" });
			rerender(<LearningCalendar {...cycleStartProps} />);

			expect(
				screen.queryByTestId("calendar-flip-book"),
			).not.toBeInTheDocument();
			expect(
				container.querySelector("[class*='yearGrid']"),
			).not.toBeNull();
		});

		it("builds cycle books with boundary months inside the window", async () => {
			setSearchParam("578512", { view: "cycle", cycle: "4", flip: "1" });
			render(<LearningCalendar {...cycleStartProps} />);
			await screen.findByTestId("calendar-flip-book");
			const props = mockFlipBookProps.current;
			expect(props).not.toBeNull();
			// Cycle 4 spans more than a year of months; the first sheet must be
			// the cycle's start month and every sheet carries month cells.
			expect(props?.months.length).toBeGreaterThan(12);
			expect(props?.months[0].cells.length).toBeGreaterThan(0);
			expect(props?.isDimmed).toBeDefined();
		});
	});

});
