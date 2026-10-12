/**
 * @jest-environment jsdom
 *
 * Unit tests for MasoraSefer — the מסורה flipbook that lays a sefer
 * out as Masoretic (פתוחה/סתומה) parasha spreads, each text page
 * followed by its bounded commentary blank. The shared book chrome
 * (UnitSeferBook) renders for real against mocked
 * html-flip-book-react primitives; blank-page content and the
 * summary server action are mocked so the tests assert the wiring —
 * pages, semantics, history, toolbar, content navigation — without
 * pulling database modules into jsdom.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";

let capturedFlipBookProps: Record<string, unknown> = {};
let capturedTocProps: Record<string, unknown> = {};
const mockUnitTextBodies: Array<Record<string, unknown>> = [];
// Latest props per blank page, keyed `{unitId}:{scope}` — the book
// re-renders (summary batch, content selection), and only the newest
// props describe what a reader sees.
const mockBlankPages = new Map<string, Record<string, unknown>>();
const mockRestorePage = jest.fn();
const mockJumpToPage = jest.fn();
const mockGetCurrentPageIndex = jest.fn().mockReturnValue(0);
const mockSummariesBatch = jest.fn();

jest.mock("next/dynamic", () => {
	const { forwardRef, useImperativeHandle } =
		require("react") as typeof import("react");
	return (loader: () => Promise<unknown>) => {
		(globalThis as Record<string, unknown>).__masoraDynamicLoader = loader;
		return forwardRef(function MockFlipBook(
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
	};
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
		MouseModeButton: () => (
			<button type="button" aria-label="בחירת טקסט עם העכבר" />
		),
		NextButton: () => <div />,
		PageIndicator: () => <div />,
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

jest.mock("@/app/components/reading/UnitTextBody", () => ({
	UnitTextBody: (props: Record<string, unknown>) => {
		mockUnitTextBodies.push(props);
		return <div data-testid="unit-text" />;
	},
}));

jest.mock("@/app/components/reading/UnitBlankPageContent", () => ({
	UnitBlankPageContent: (props: Record<string, unknown>) => {
		mockBlankPages.set(`${props.unitId}:${props.scope}`, props);
		return <div data-testid="unit-blank" />;
	},
}));

// Keep the server action (and its database/corpus imports) out of
// jsdom; the batch returns per-unit summaries the blank pages consume.
jest.mock("@/app/components/reading/unit-book-actions", () => ({
	getUnitScopeSummariesBatch: (...args: unknown[]) =>
		mockSummariesBatch(...args),
}));

jest.mock("@/data/sefer-colors", () => ({
	getSeferColor: () => "hsl(30, 80%, 50%)",
}));

import MasoraSefer from "@/app/masora/[unit]/components/MasoraSefer";
import type {
	BookPage,
	MasoraBookUnit,
} from "@/app/masora/[unit]/components/masora-book-utils";
import type { Perek } from "@/data/db/tanah-view-types";
import type { ScriptureRange } from "@/lib/reading/contract";

const range = (
	startPerek: number,
	startPasuk: number,
	endPerek: number,
	endPasuk: number,
): ScriptureRange => ({
	start: { perekId: startPerek, pasuk: startPasuk },
	end: { perekId: endPerek, pasuk: endPasuk },
});

const perek = (pesukim: number): Perek => ({
	header: "",
	date: [],
	star_rise: [],
	pesukim: Array.from({ length: pesukim }, () => ({ segments: [] })),
});

const units: MasoraBookUnit[] = [
	{
		unitId: 1,
		order: 1,
		heading: "בראשית א א-ה",
		ranges: [range(1, 1, 1, 5)],
		closingBreak: "ptuha",
	},
	{
		unitId: 2,
		order: 2,
		heading: "בראשית א ו-כט",
		ranges: [range(1, 6, 1, 29)],
		closingBreak: "stuma",
	},
];

const currentUnitSummaries = {
	articles: [
		{
			id: 7,
			perekId: 1,
			authorId: 1,
			abstract: null,
			name: "מאמר בראשית",
			priority: 1,
			authorName: "מחבר",
			authorImageUrl: "",
		},
	],
	perushim: [
		{
			id: 3,
			name: 'רש"י',
			parshanName: 'רש"י',
			noteCount: 4,
			perekId: 1,
		},
	],
};

const baseProps = () => ({
	units,
	seferName: "בראשית",
	currentUnitId: 1,
	entityRefsByPerek: {},
	perekSources: { 1: "בראשית א" } as Record<number, string>,
	perekById: new Map<number, Perek>([[1, perek(3)]]),
	...currentUnitSummaries,
	initialBookPage: null as BookPage | null,
});

describe("MasoraSefer", () => {
	beforeEach(() => {
		capturedFlipBookProps = {};
		capturedTocProps = {};
		mockUnitTextBodies.length = 0;
		mockBlankPages.clear();
		mockRestorePage.mockClear();
		mockJumpToPage.mockClear();
		mockGetCurrentPageIndex.mockReset().mockReturnValue(0);
		// Never resolve by default — tests that don't await the batch
		// would otherwise hit act() warnings on the summary setState.
		mockSummariesBatch.mockReset().mockReturnValue(
			new Promise(() => {}),
		);
		history.replaceState(null, "", "/מסורה/1?book");
	});

	it("lays out cover, contents, and a text + blank spread per unit", () => {
		render(<MasoraSefer {...baseProps()} />);
		expect(screen.getByTestId("mock-flipbook")).toBeInTheDocument();
		expect(screen.getByTestId("mock-toc")).toBeInTheDocument();
		// cover + cover-interior + TOC + (units * 2) + back cover.
		const pages = capturedFlipBookProps.pages as React.ReactNode[];
		expect(pages).toHaveLength(3 + units.length * 2 + 1);
		expect(capturedFlipBookProps.mouseModeStorageKey).toBe(
			"masora-sefer-mouse-book-mode",
		);
		expect(capturedFlipBookProps.of).toBe("ב");
		expect(capturedFlipBookProps.tocPageIndex).toBe(2);
	});

	it("renders covers, unit headings, and closing-break markers", () => {
		render(<MasoraSefer {...baseProps()} />);
		expect(screen.getByLabelText("עטיפה קדמית")).toHaveTextContent(
			"ספר בראשית",
		);
		expect(screen.getByLabelText("עטיפה קדמית")).toHaveTextContent(
			"מסורה על הפרק",
		);
		expect(screen.getByLabelText("עטיפה אחורית")).toBeInTheDocument();
		expect(screen.getByText("בראשית א א-ה")).toBeInTheDocument();
		expect(screen.getByText("פרשה פתוחה")).toBeInTheDocument();
		expect(screen.getByText("בראשית א ו-כט")).toBeInTheDocument();
		expect(screen.getByText("פרשה סתומה")).toBeInTheDocument();
		expect(mockUnitTextBodies).toHaveLength(2);
		expect(mockUnitTextBodies[0].ranges).toBe(units[0].ranges);
		expect(mockUnitTextBodies[1].ranges).toBe(units[1].ranges);
	});

	it("gives every unit a torah-scoped commentary blank", () => {
		render(<MasoraSefer {...baseProps()} />);
		expect(mockBlankPages.size).toBe(2);
		expect(
			[...mockBlankPages.values()].every(
				(page) => page.division === "masora" && page.scope === "torah",
			),
		).toBe(true);
	});

	it("passes the current unit's SSG summaries to its blank", () => {
		render(<MasoraSefer {...baseProps()} />);
		const blank = mockBlankPages.get("1:torah");
		expect(blank?.articles).toBe(currentUnitSummaries.articles);
		expect(blank?.perushim).toBe(currentUnitSummaries.perushim);
	});

	it("batch-loads commentary summaries for the other units' blanks", async () => {
		mockSummariesBatch.mockResolvedValue({
			"2": {
				articles: [],
				perushim: currentUnitSummaries.perushim,
			},
		});
		render(<MasoraSefer {...baseProps()} />);
		expect(mockSummariesBatch).toHaveBeenCalledWith("masora", [2], "torah");
		await act(async () => {});
		expect(mockBlankPages.get("2:torah")?.perushim).toBe(
			currentUnitSummaries.perushim,
		);
	});

	it("opens the current unit's text page on mount", () => {
		render(<MasoraSefer {...baseProps()} currentUnitId={2} />);
		// Unit 2's text page sits at index 5 → ceil(5 / 2) turned leaves.
		expect(capturedFlipBookProps.initialTurnedLeaves).toEqual([0, 1, 2]);
	});

	it.each([
		["front", []],
		["toc", [0]],
		["back", [0, 1, 2, 3]],
	] as const)(
		"opens the book chrome %s page at its leaf",
		(page, expected) => {
			render(<MasoraSefer {...baseProps()} initialBookPage={page} />);
			expect(capturedFlipBookProps.initialTurnedLeaves).toEqual(expected);
		},
	);

	it("restores the requested page when it differs from the current page", () => {
		render(<MasoraSefer {...baseProps()} currentUnitId={2} />);
		expect(mockRestorePage).toHaveBeenCalledWith(5);
	});

	it("does not restore when the book already shows the requested page", () => {
		mockGetCurrentPageIndex.mockReturnValue(3);
		render(<MasoraSefer {...baseProps()} />);
		expect(mockRestorePage).not.toHaveBeenCalled();
	});

	it("seeds a content selection from an initial deep link", () => {
		render(
			<MasoraSefer
				{...baseProps()}
				initialContent={{ scope: "torah", kind: "perush", slug: 'רש"י' }}
			/>,
		);
		expect(mockBlankPages.get("1:torah")?.initialSlug).toBe('רש"י');
	});

	it("routes blank-page navigation through the unit content history", () => {
		render(<MasoraSefer {...baseProps()} />);
		const onNavigate = mockBlankPages.get("1:torah")?.onNavigate as (
			kind?: string,
			slug?: string,
		) => void;
		expect(typeof onNavigate).toBe("function");
		act(() => {
			onNavigate("perush", 'רש"י');
		});
		expect(decodeURIComponent(window.location.search)).toContain(
			'perush=רש"י',
		);
		expect(window.location.search).toContain("book=");
		expect(mockBlankPages.get("1:torah")?.initialSlug).toBe('רש"י');
		act(() => {
			onNavigate();
		});
		expect(window.location.search).not.toContain("perush=");
		expect(mockBlankPages.get("1:torah")?.initialSlug).toBeUndefined();
	});

	it("marks text pages for the facing blank's pasuk navigation", () => {
		render(<MasoraSefer {...baseProps()} />);
		expect(
			document.querySelector('[data-sefer-unit-text="1:torah"]'),
		).not.toBeNull();
		expect(
			document.querySelector('[data-sefer-unit-text="2:torah"]'),
		).not.toBeNull();
	});

	it("resolves perek data and pasuk counts through the loaded map", () => {
		render(<MasoraSefer {...baseProps()} />);
		const [body] = mockUnitTextBodies;
		const pasukCount = body.pasukCount as (perekId: number) => number;
		const resolvePerek = body.resolvePerek as (
			perekId: number,
		) => { pesukim: unknown[]; source: string } | undefined;
		expect(pasukCount(1)).toBe(3);
		expect(pasukCount(999)).toBe(1);
		expect(resolvePerek(1)).toEqual({
			pesukim: perek(3).pesukim,
			source: "בראשית א",
		});
		expect(resolvePerek(999)).toBeUndefined();
	});

	it("wires TOC navigation, entry hrefs, and the contents filter", () => {
		render(<MasoraSefer {...baseProps()} />);
		const onNavigate = capturedTocProps.onNavigate as (idx: number) => void;
		act(() => onNavigate(3));
		expect(mockJumpToPage).toHaveBeenCalledWith(3);

		const getHref = capturedTocProps.getHref as (entry: {
			pageIndex: number;
			semanticName: string;
			title: string;
		}) => string | null;
		expect(getHref({ pageIndex: 0, semanticName: "", title: "" })).toBe(
			"/מסורה/1/כריכה?book",
		);
		expect(getHref({ pageIndex: 2, semanticName: "", title: "" })).toBe(
			"/מסורה/1/תוכן?book",
		);
		expect(
			getHref({ pageIndex: 3, semanticName: "א", title: "בראשית א א-ה" }),
		).toBe("/מסורה/1?book");
		// The blank shares its text page's route.
		expect(getHref({ pageIndex: 4, semanticName: "", title: "" })).toBe(
			"/מסורה/1?book",
		);
		expect(
			getHref({ pageIndex: 5, semanticName: "ב", title: "בראשית א ו-כט" }),
		).toBe("/מסורה/2?book");
		expect(getHref({ pageIndex: 7, semanticName: "", title: "" })).toBe(
			"/מסורה/1/גב?book",
		);

		const filter = capturedTocProps.filter as (entry: {
			pageIndex: number;
			title: string;
		}) => boolean;
		expect(filter({ pageIndex: 2, title: "x" })).toBe(false);
		expect(filter({ pageIndex: 3, title: "" })).toBe(false);
		expect(filter({ pageIndex: 3, title: "בראשית א א-ה" })).toBe(true);
	});

	it("lazy-loads the real FlipBook through the dynamic loader", async () => {
		render(<MasoraSefer {...baseProps()} />);
		const loader = (globalThis as Record<string, unknown>)
			.__masoraDynamicLoader as (() => Promise<{
			FlipBook?: unknown;
		}>) | null;
		expect(loader).not.toBeNull();
		if (!loader) {
			throw new Error("dynamic loader was not captured");
		}
		await expect(loader()).resolves.toBeUndefined();
	});

	it("opens and closes the bookshelf modal from the toolbar", () => {
		render(<MasoraSefer {...baseProps()} />);
		expect(screen.queryByTestId("mock-modal")).toBeNull();
		fireEvent.click(screen.getByLabelText('ספרי התנ"ך'));
		expect(screen.getByTestId("mock-modal")).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("close-modal"));
		expect(screen.queryByTestId("mock-modal")).toBeNull();
	});
});
