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
	lastProps: {
		pages?: unknown[];
		of?: number;
		initialTurnedLeaves?: number[];
	} | null;
	lastToolbarProps: {
		commandOptions?: Record<
			string,
			{ hotkeys?: { key: string }[]; disableHotkeys?: boolean }
		>;
	} | null;
} = {
	currentPageIndex: 0,
	jumpToPage: jest.fn(),
	attachHandle: true,
	lastHandlers: null,
	lastProps: null,
	lastToolbarProps: null,
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
		Toolbar: (props: {
			children: React.ReactNode;
			commandOptions?: Record<
				string,
				{ hotkeys?: { key: string }[]; disableHotkeys?: boolean }
			>;
		}) => {
			engineStub.lastToolbarProps = props;
			return React.createElement("div", { role: "toolbar" }, props.children);
		},
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
	requestedMonth: { year: 5785, month: 2 },
	todayDateNumber: -1,
	onMonthChange: jest.fn(),
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
		// The engine settles on the requested month's sheet face after
		// initialTurnedLeaves — page 5 is month {5785,2}'s readable face.
		engineStub.currentPageIndex = 5;
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
		expect(engineStub.lastProps).toMatchObject({
			of: months.length,
			initialTurnedLeaves: [0, 1, 2],
		});
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

	// Covered-face exposure is owned by the published vertical engine since
	// alpha.121 — no app-side inert/aria-hidden pass runs here. The real
	// engine's exposure contract is covered by the e2e calendar tests.
	it("binds vertical turn hotkeys through the toolbar command API", () => {
		render(<CalendarFlipBook {...baseProps} />);
		expect(
			engineStub.lastToolbarProps?.commandOptions?.flipNext?.hotkeys,
		).toEqual([{ key: "ArrowUp" }, { key: "PageDown" }, { key: " " }]);
		expect(
			engineStub.lastToolbarProps?.commandOptions?.flipPrev?.hotkeys,
		).toEqual([{ key: "ArrowDown" }, { key: "PageUp" }]);
	});

	it("moves to a same-scope externally selected month (e.g. the cycle picker staying in the displayed year)", () => {
		const { rerender } = render(<CalendarFlipBook {...baseProps} />);
		rerender(
			<CalendarFlipBook
				{...baseProps}
				requestedMonth={{ year: 5785, month: 3 }}
			/>,
		);
		// Third month pair → readable face at index 7.
		expect(engineStub.jumpToPage).toHaveBeenCalledWith(7);
	});

	it("does not jump when the requested month already matches the engine", () => {
		const { rerender } = render(<CalendarFlipBook {...baseProps} />);
		// The engine sits on {5785,2}; re-requesting it must not bounce a
		// reported position back into a redundant jump.
		rerender(<CalendarFlipBook {...baseProps} />);
		expect(engineStub.jumpToPage).not.toHaveBeenCalled();
	});

	it("clamps a request outside the book to the nearest month", () => {
		const { rerender } = render(<CalendarFlipBook {...baseProps} />);
		rerender(
			<CalendarFlipBook
				{...baseProps}
				requestedMonth={{ year: 5790, month: 5 }}
			/>,
		);
		// Far-future month clamps to the last month (position 2 → index 7).
		expect(engineStub.jumpToPage).toHaveBeenCalledWith(7);
	});

	it("a remounted book opens on its own request without repeating the previous instance's", () => {
		// Today then a year change remounts the book through the scope key:
		// the new instance must open on the year-selected month, not replay
		// an earlier request the previous book already consumed.
		const { unmount } = render(<CalendarFlipBook {...baseProps} />);
		unmount();
		engineStub.jumpToPage.mockClear();
		// The remounted engine opens on {5785,3}'s spread (page index 7).
		engineStub.currentPageIndex = 7;
		render(
			<CalendarFlipBook
				{...baseProps}
				requestedMonth={{ year: 5785, month: 3 }}
			/>,
		);
		expect(engineStub.lastProps?.initialTurnedLeaves).toEqual([0, 1, 2, 3]);
		expect(engineStub.jumpToPage).not.toHaveBeenCalled();
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
					requestedMonth={{ year: 5785, month: 3 }}
				/>,
			);
			expect(engineStub.jumpToPage).not.toHaveBeenCalled();
		} finally {
			engineStub.attachHandle = true;
		}
	});
});
