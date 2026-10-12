/**
 * @jest-environment jsdom
 *
 * Shared flipbook chrome of the alternative-division sefer books
 * (issue #2191): covers, contents page, toolbar, bookshelf modal,
 * scroll lock, route restoration, and the committed-page callback —
 * all division-agnostic, driven by the props the מסורה/פרשה books
 * supply.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";

let capturedFlipBookProps: Record<string, unknown> = {};
let capturedTocProps: Record<string, unknown> = {};
const mockRestorePage = jest.fn();
const mockJumpToPage = jest.fn();
const mockGetCurrentPageIndex = jest.fn().mockReturnValue(0);

jest.mock("next/dynamic", () => {
	const { forwardRef, useImperativeHandle } =
		require("react") as typeof import("react");
	return () =>
		forwardRef(function MockFlipBook(
			props: Record<string, unknown>,
			ref,
		) {
			capturedFlipBookProps = props;
			useImperativeHandle(ref, () => ({
				getCurrentPageIndex: mockGetCurrentPageIndex,
				restorePage: mockRestorePage,
				jumpToPage: mockJumpToPage,
			}));
			return (
				<div data-testid="mock-flipbook">
					{props.pages as React.ReactNode[]}
				</div>
			);
		});
});

jest.mock(
	"html-flip-book-react",
	() => ({
		TocPage: (props: Record<string, unknown>) => {
			capturedTocProps = props;
			return <div data-testid="mock-toc" />;
		},
	}),
	{ virtual: true },
);

jest.mock(
	"html-flip-book-react/toolbar",
	() => ({
		ActionButton: ({
			onClick,
			children,
			ariaLabel,
		}: {
			onClick: () => void;
			children: React.ReactNode;
			ariaLabel: string;
		}) => (
			<button type="button" onClick={onClick} aria-label={ariaLabel}>
				{children}
			</button>
		),
		BookshelfIcon: () => <span>{"shelf"}</span>,
		FirstPageButton: () => <div />,
		FullscreenButton: () => <div />,
		LastPageButton: () => <div />,
		MouseModeButton: () => <div />,
		NextButton: () => <div />,
		PageIndicator: ({ ariaLabel }: { ariaLabel: string }) => (
			<button type="button" aria-label={ariaLabel} />
		),
		PrevButton: () => <div />,
		TocButton: () => <div />,
		Toolbar: ({ children }: { children: React.ReactNode }) => (
			<div>{children}</div>
		),
	}),
	{ virtual: true },
);

jest.mock("html-flip-book-react/styles.css", () => ({}), { virtual: true });
jest.mock("@/app/929/[number]/components/sefer.css", () => ({}));
jest.mock("@/app/929/[number]/components/sefer.module.css", () => ({}));

jest.mock("@/app/components/Bookshelf", () => ({
	BookshelfModal: ({
		isOpen,
		onClose,
	}: {
		isOpen: boolean;
		onClose: () => void;
	}) =>
		isOpen ? (
			<div data-testid="mock-modal">
				<button type="button" onClick={onClose} data-testid="close-modal">
					close
				</button>
			</div>
		) : null,
}));

jest.mock("@/data/sefer-colors", () => ({
	getSeferColor: () => "hsl(30, 80%, 50%)",
}));

import { UnitSeferBook } from "@/app/components/reading/UnitSeferBook";

const pageSemantics = {
	pages: [],
	getSemanticName: () => "",
} as never;

const historyMapper = {
	pageToRoute: jest
		.fn()
		.mockImplementation(
			(index: number, entry: { title?: string }) =>
				`/מסורה/${index}?book${entry.title ? `&t=${entry.title}` : ""}`,
		),
	routeToPage: jest.fn().mockReturnValue(4),
};

function renderBook(extra: Record<string, unknown> = {}) {
	return render(
		<UnitSeferBook
			seferName="בראשית"
			coverSubtitle="מסורה על הפרק"
			contentPages={[<div key="u1" />, <div key="u2" />]}
			contentOffset={3}
			pageSemantics={pageSemantics}
			historyMapper={historyMapper}
			of="ב"
			mouseModeStorageKey="masora-sefer-mouse-book-mode"
			pageIndicatorLabel="עבור לפרשה (מספר עברי)"
			{...extra}
		/>,
	);
}

describe("UnitSeferBook", () => {
	beforeEach(() => {
		capturedFlipBookProps = {};
		capturedTocProps = {};
		mockRestorePage.mockClear();
		mockJumpToPage.mockClear();
		mockGetCurrentPageIndex.mockReset().mockReturnValue(0);
		historyMapper.pageToRoute.mockClear();
		delete document.documentElement.dataset.seferView;
	});

	it("lays out covers, the contents page, and the toolbar", () => {
		renderBook();
		const pages = capturedFlipBookProps.pages as React.ReactNode[];
		// cover + interior + toc + 2 content pages + back cover.
		expect(pages).toHaveLength(6);
		expect(screen.getByLabelText("עטיפה קדמית")).toHaveTextContent(
			"ספר בראשית",
		);
		expect(screen.getByLabelText("עטיפה קדמית")).toHaveTextContent(
			"מסורה על הפרק",
		);
		expect(screen.getByLabelText("עטיפה אחורית")).toBeInTheDocument();
		expect(screen.getByTestId("mock-toc")).toBeInTheDocument();
		expect(
			screen.getByLabelText("עבור לפרשה (מספר עברי)"),
		).toBeInTheDocument();
	});

	it("shows the optional cover edition line only when provided", () => {
		const first = renderBook();
		expect(
			screen.queryByText("פרשיות פתוחות וסתומות"),
		).not.toBeInTheDocument();
		first.unmount();
		renderBook({ coverEdition: "פרשיות פתוחות וסתומות" });
		expect(screen.getByText("פרשיות פתוחות וסתומות")).toBeInTheDocument();
	});

	it("restores a requested page only when it differs from the current", () => {
		renderBook({ requestedPage: 4 });
		expect(mockRestorePage).toHaveBeenCalledWith(4);

		mockRestorePage.mockClear();
		mockGetCurrentPageIndex.mockReturnValue(4);
		renderBook({ requestedPage: 4 });
		expect(mockRestorePage).not.toHaveBeenCalled();

		renderBook();
		expect(mockRestorePage).not.toHaveBeenCalled();
	});

	it("locks document scrolling only while the reader is visible", () => {
		const view = renderBook();
		expect(document.documentElement.dataset.seferView).toBe("");

		view.rerender(
			<UnitSeferBook
				seferName="בראשית"
				coverSubtitle="מסורה על הפרק"
				contentPages={[<div key="u1" />]}
				contentOffset={3}
				pageSemantics={pageSemantics}
				historyMapper={historyMapper}
				of="א"
				mouseModeStorageKey="k"
				pageIndicatorLabel="x"
				isVisible={false}
			/>,
		);
		expect(document.documentElement.dataset.seferView).toBeUndefined();

		view.unmount();
		expect(document.documentElement.dataset.seferView).toBeUndefined();
	});

	it("forwards the committed page index to onPageFlipped", () => {
		const onPageFlipped = jest.fn();
		mockGetCurrentPageIndex.mockReturnValue(7);
		renderBook({ onPageFlipped });
		const handlers = capturedFlipBookProps.handlers as {
			onPageFlipped: () => void;
		};
		act(() => handlers.onPageFlipped());
		expect(onPageFlipped).toHaveBeenCalledWith(7);
	});

	it("tolerates a missing handler and null page index", () => {
		renderBook();
		const handlers = capturedFlipBookProps.handlers as {
			onPageFlipped: () => void;
		};
		mockGetCurrentPageIndex.mockReturnValue(undefined as never);
		expect(() => act(() => handlers.onPageFlipped())).not.toThrow();
	});

	it("routes TOC navigation through the book handle and mapper", () => {
		renderBook();
		const onNavigate = capturedTocProps.onNavigate as (idx: number) => void;
		act(() => onNavigate(5));
		expect(mockJumpToPage).toHaveBeenCalledWith(5);

		const getHref = capturedTocProps.getHref as (entry: {
			pageIndex: number;
			semanticName: string;
			title: string;
		}) => string;
		expect(getHref({ pageIndex: 3, semanticName: "", title: "כותרת" })).toBe(
			"/מסורה/3?book&t=כותרת",
		);

		const filter = capturedTocProps.filter as (entry: {
			pageIndex: number;
			title: string;
		}) => boolean;
		expect(filter({ pageIndex: 2, title: "x" })).toBe(false);
		expect(filter({ pageIndex: 3, title: "" })).toBe(false);
		expect(filter({ pageIndex: 3, title: "כותרת" })).toBe(true);
	});

	it("opens and closes the bookshelf modal", () => {
		renderBook();
		fireEvent.click(screen.getByLabelText('ספרי התנ"ך'));
		expect(screen.getByTestId("mock-modal")).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("close-modal"));
		expect(screen.queryByTestId("mock-modal")).toBeNull();
	});
});
