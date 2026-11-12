/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import type { FlipMonthEntry } from "@/app/calendar/components/flip-month-data";

// The real engine is layout-dependent and ESM-only; tests drive the
// component through a stub that renders every page element inside `.page`
// wrappers and exposes a controllable FlipBookHandle.
const engineStub: {
	currentPageIndex: number;
	jumpToPage: jest.Mock;
	attachHandle: boolean;
	lastHandlers: { onPageFlipped?: () => void } | null;
	lastProps: { pages?: unknown[]; of?: number } | null;
} = {
	currentPageIndex: 0,
	jumpToPage: jest.fn(),
	attachHandle: true,
	lastHandlers: null,
	lastProps: null,
};

jest.mock(
	"html-flip-book-react",
	() => {
	const React = jest.requireActual<typeof import("react")>("react");
	const FlipBook = React.forwardRef(
		(
			props: {
				pages: React.ReactNode[];
				handlers?: { onPageFlipped?: () => void };
				of?: number;
			},
			ref: React.Ref<unknown>,
		) => {
			engineStub.lastHandlers = props.handlers ?? null;
			engineStub.lastProps = props;
			// attachHandle=false simulates a missing engine handle (null ref).
			React.useImperativeHandle(ref, () =>
				engineStub.attachHandle
					? {
							getCurrentPageIndex: () => engineStub.currentPageIndex,
							jumpToPage: engineStub.jumpToPage,
						}
					: null,
			);
			return React.createElement(
				"div",
				{ "data-testid": "mock-book" },
				props.pages.map((page, index) =>
					React.createElement(
						"div",
						{ key: index, className: "page" },
						page,
					),
				),
			);
		},
	);
	FlipBook.displayName = "MockFlipBook";
	return { FlipBook };
	},
	{ virtual: true },
);

jest.mock("html-flip-book-react/toolbar", () => {
	const React = jest.requireActual<typeof import("react")>("react");
	const button =
		(name: string) =>
		({ children, ariaLabel, onClick }: Record<string, unknown>) =>
			React.createElement(
				"button",
				{ type: "button", "aria-label": ariaLabel ?? name, onClick },
				children as React.ReactNode,
			);
	return {
		Toolbar: ({ children }: { children: React.ReactNode }) =>
			React.createElement("div", { role: "toolbar" }, children),
		ActionButton: button("action"),
		FirstPageButton: button("first"),
		LastPageButton: button("last"),
		NextButton: button("next"),
		PrevButton: button("prev"),
		PageIndicator: ({ ariaLabel }: { ariaLabel?: string }) =>
			React.createElement("button", { type: "button", "aria-label": ariaLabel }),
	};
}, { virtual: true });

jest.mock(
	"@/app/calendar/components/CalendarPdfDownload",
	() => ({
		CalendarPdfDownload: () => null,
	}),
);

import { CalendarFlipBook } from "@/app/calendar/components/CalendarFlipBook";
import type { CalendarDay } from "@/data/learning-schedule";

function makeMonth(year: number, month: number): FlipMonthEntry {
	return {
		ref: { year, month },
		semanticName: `m-${year}-${month}`,
		cells: [],
	};
}

const months = [makeMonth(5785, 1), makeMonth(5785, 2), makeMonth(5785, 3)];

const baseProps = {
	months,
	scopeLabel: "שנת ה'תשפ\"ה",
	initialMonth: { year: 5785, month: 2 },
	todayDateNumber: -1,
	onMonthChange: jest.fn(),
	jumpRequest: null as { month: { year: number; month: number }; nonce: number } | null,
	onOpenPerek: jest.fn(),
	dayAriaLabel: (day: CalendarDay) => `day ${day.dateNumber}`,
	mergedDayAriaLabel: (a: CalendarDay, b: CalendarDay) =>
		`${a.dateNumber}+${b.dateNumber}`,
	isDimmed: undefined,
	onToday: jest.fn(),
	onShowOverview: jest.fn(),
	pdfRequest: {
		apiUrl: "/api/calendar-pdf?x",
		manifestUrl: "/m.json",
		artifactKey: "k",
		filename: "f.pdf",
	},
	pdfScopeLabel: "שנת ה'תשפ\"ה",
	pdfUnavailableReason: undefined,
};

describe("CalendarFlipBook", () => {
	beforeEach(() => {
		engineStub.currentPageIndex = 0;
		engineStub.jumpToPage.mockClear();
		baseProps.onMonthChange.mockClear();
	});

	it("renders chrome faces plus a sheet pair per month", () => {
		render(<CalendarFlipBook {...baseProps} />);
		const pages = engineStub.lastProps?.pages ?? [];
		// 3 chrome + 2 faces per month + 2 back chrome.
		expect(pages).toHaveLength(3 + months.length * 2 + 2);
		const monthGrids = document.querySelectorAll(".cal-sheet");
		expect(monthGrids).toHaveLength(months.length);
		const cardBacks = document.querySelectorAll(".cal-sheet-back");
		expect(cardBacks).toHaveLength(months.length);
	});

	it("opens on the spread containing the requested initial month", () => {
		render(<CalendarFlipBook {...baseProps} />);
		// Month 2 is the second pair: readable face at page index 5 →
		// leaves 0..2 turned so the spread shows pages 5-6.
		expect(engineStub.lastProps).toMatchObject({ of: months.length });
	});

	it("reports the top readable month after each committed turn", () => {
		render(<CalendarFlipBook {...baseProps} />);
		engineStub.currentPageIndex = 5; // second month sheet face
		act(() => engineStub.lastHandlers?.onPageFlipped?.());
		expect(baseProps.onMonthChange).toHaveBeenCalledWith({
			year: 5785,
			month: 2,
		});
	});

	it("ignores flips landing on chrome faces", () => {
		render(<CalendarFlipBook {...baseProps} />);
		engineStub.currentPageIndex = 1; // blank endpaper
		act(() => engineStub.lastHandlers?.onPageFlipped?.());
		expect(baseProps.onMonthChange).not.toHaveBeenCalled();
	});

	it("marks covered faces inert and exposes only the visible pair", () => {
		const { container } = render(<CalendarFlipBook {...baseProps} />);
		const pages = container.querySelectorAll<HTMLElement>(".page");
		pages[0].classList.add("current-page");
		pages[1].classList.add("page--flipping");
		act(() => engineStub.lastHandlers?.onPageFlipped?.());
		expect(pages[0]).not.toHaveAttribute("inert");
		expect(pages[1]).not.toHaveAttribute("inert");
		expect(pages[2]).toHaveAttribute("inert");
		expect(pages[2]).toHaveAttribute("aria-hidden", "true");
	});

	it("jumps imperatively to a requested month", () => {
		const { rerender } = render(<CalendarFlipBook {...baseProps} />);
		rerender(
			<CalendarFlipBook
				{...baseProps}
				jumpRequest={{ month: { year: 5785, month: 3 }, nonce: 1 }}
			/>,
		);
		// Third month pair → readable face at index 7.
		expect(engineStub.jumpToPage).toHaveBeenCalledWith(7);
	});

	it("clamps a jump request outside the book to the nearest month", () => {
		const { rerender } = render(<CalendarFlipBook {...baseProps} />);
		rerender(
			<CalendarFlipBook
				{...baseProps}
				jumpRequest={{ month: { year: 5790, month: 5 }, nonce: 2 }}
			/>,
		);
		// Far-future month clamps to the last month (position 2 → index 7).
		expect(engineStub.jumpToPage).toHaveBeenCalledWith(7);
	});

	it("prints the cycle detail line on the title page when provided", () => {
		render(<CalendarFlipBook {...baseProps} scopeDetail="מחזור ד'" />);
		expect(
			document.querySelector(".cal-title-page__detail"),
		).toHaveTextContent("מחזור ד'");
	});

	it("no-ops safely when the engine handle is unavailable", () => {
		engineStub.attachHandle = false;
		try {
			const { rerender } = render(<CalendarFlipBook {...baseProps} />);
			// A flip event without a mounted handle must not throw.
			expect(() =>
				act(() => engineStub.lastHandlers?.onPageFlipped?.()),
			).not.toThrow();
			rerender(
				<CalendarFlipBook
					{...baseProps}
					jumpRequest={{ month: { year: 5785, month: 2 }, nonce: 3 }}
				/>,
			);
			expect(engineStub.jumpToPage).not.toHaveBeenCalled();
		} finally {
			engineStub.attachHandle = true;
		}
	});
});
