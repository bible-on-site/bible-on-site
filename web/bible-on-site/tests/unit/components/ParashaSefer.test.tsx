/**
 * @jest-environment jsdom
 *
 * Unit tests for ParashaSefer — the פרשה flipbook that lays a Torah
 * sefer out as parasha spreads, each Torah and Haftarah text page
 * followed by its bounded commentary blank. The shared book chrome
 * (UnitSeferBook) renders here for real against mocked
 * html-flip-book-react primitives; the blank-page content and the
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
		(globalThis as Record<string, unknown>).__parashaDynamicLoader =
			loader;
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
		BookshelfIcon: () => <span>shelf</span>,
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
// jsdom; the batch returns per-scope summaries the blank pages consume.
jest.mock("@/app/components/reading/unit-book-actions", () => ({
	getUnitScopeSummariesBatch: (...args: unknown[]) =>
		mockSummariesBatch(...args),
}));

jest.mock("@/data/sefer-colors", () => ({
	getSeferColor: () => "hsl(30, 80%, 50%)",
}));

import ParashaSefer from "@/app/parasha/[unit]/components/ParashaSefer";
import type {
	BookPage,
	ParashaBookUnit,
} from "@/app/parasha/[unit]/components/parasha-book-utils";
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

const units: ParashaBookUnit[] = [
	{
		unitId: 1,
		name: "בראשית",
		order: 1,
		refSpan: "בראשית א א - ו ח",
		ranges: [range(1, 1, 6, 8)],
		haftarot: [
			{
				id: "haftara-ashkenazi",
				label: "אשכנזים",
				refSpan: "ישעיהו מב ה-כה",
				ranges: [range(335, 5, 335, 25)],
				note: "variant note",
			},
		],
		notes: ["a parasha note"],
	},
	{
		unitId: 2,
		name: "נח",
		order: 2,
		refSpan: "בראשית ו ט - יא לב",
		ranges: [range(6, 9, 11, 32)],
		haftarot: [],
		notes: [],
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
	haftaraArticles: [
		{
			id: 9,
			perekId: 335,
			authorId: 2,
			abstract: null,
			name: "מאמר הפטרה",
			priority: 1,
			authorName: "מחבר ב",
			authorImageUrl: "",
		},
	],
	haftaraPerushim: [
		{
			id: 5,
			name: 'רד"ק',
			parshanName: 'רד"ק',
			noteCount: 2,
			perekId: 335,
		},
	],
};

const baseProps = () => ({
	units,
	seferName: "בראשית",
	currentUnitId: 1,
	entityRefsByPerek: {},
	perekSources: { 1: "בראשית א" } as Record<number, string>,
	perekById: new Map<number, Perek>([
		[1, perek(3)],
		[335, perek(2)],
	]),
	...currentUnitSummaries,
	initialBookPage: null as BookPage | null,
	haftara: false,
});

describe("ParashaSefer", () => {
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
		history.replaceState(null, "", "/פרשה/1?book");
	});

	it("lays out cover, contents, and Torah + Haftarah spreads per parasha", () => {
		render(<ParashaSefer {...baseProps()} />);
		expect(screen.getByTestId("mock-flipbook")).toBeInTheDocument();
		expect(screen.getByTestId("mock-toc")).toBeInTheDocument();
		// cover + cover-interior + TOC + (units * 4) + back cover —
		// each unit's Torah spread and Haftarah spread is text + blank.
		const pages = capturedFlipBookProps.pages as React.ReactNode[];
		expect(pages).toHaveLength(3 + units.length * 4 + 1);
		expect(capturedFlipBookProps.mouseModeStorageKey).toBe(
			"parasha-sefer-mouse-book-mode",
		);
		expect(capturedFlipBookProps.of).toBe("ב");
		expect(capturedFlipBookProps.tocPageIndex).toBe(2);
	});

	it("renders covers, parasha headers, Haftarah variants, and notes", () => {
		render(<ParashaSefer {...baseProps()} />);
		expect(screen.getByLabelText("עטיפה קדמית")).toHaveTextContent(
			"ספר בראשית",
		);
		expect(screen.getByLabelText("עטיפה אחורית")).toBeInTheDocument();
		expect(screen.getByText("פרשת בראשית")).toBeInTheDocument();
		expect(screen.getByText("הפטרת בראשית")).toBeInTheDocument();
		expect(screen.getByText("הפטרה - אשכנזים")).toBeInTheDocument();
		expect(screen.getByText("ישעיהו מב ה-כה")).toBeInTheDocument();
		expect(screen.getByText("variant note")).toBeInTheDocument();
		expect(screen.getByText("a parasha note")).toBeInTheDocument();
		expect(screen.getByText("פרשת נח")).toBeInTheDocument();
		// One Torah body per unit plus one body per Haftarah variant.
		expect(mockUnitTextBodies).toHaveLength(3);
		expect(mockUnitTextBodies[0].anchorScope).toBeUndefined();
		expect(mockUnitTextBodies[1].anchorScope).toBe("haftara-ashkenazi");
		expect(mockUnitTextBodies[2].anchorScope).toBeUndefined();
	});

	it("gives every unit a Torah blank and a Haftarah blank", () => {
		render(<ParashaSefer {...baseProps()} />);
		// 2 units × 2 blank pages (torah + haftara scopes).
		expect(mockBlankPages.size).toBe(4);
		expect(
			[...mockBlankPages.values()].map((page) => page.scope),
		).toEqual(["torah", "haftara", "torah", "haftara"]);
		expect(
			[...mockBlankPages.values()].every(
				(page) => page.division === "parasha",
			),
		).toBe(true);
	});

	it("passes the current unit's SSG summaries to its blanks", () => {
		render(<ParashaSefer {...baseProps()} />);
		const torahBlank = mockBlankPages.get("1:torah");
		const haftaraBlank = mockBlankPages.get("1:haftara");
		expect(torahBlank?.articles).toBe(currentUnitSummaries.articles);
		expect(torahBlank?.perushim).toBe(currentUnitSummaries.perushim);
		expect(haftaraBlank?.articles).toBe(
			currentUnitSummaries.haftaraArticles,
		);
		expect(haftaraBlank?.perushim).toBe(
			currentUnitSummaries.haftaraPerushim,
		);
	});

	it("batch-loads commentary summaries for the other units' blanks", async () => {
		mockSummariesBatch.mockImplementation(
			(_division: string, _ids: number[], scope: string) =>
				Promise.resolve(
					scope === "torah"
						? { "2": { articles: [], perushim: currentUnitSummaries.perushim } }
						: { "2": { articles: currentUnitSummaries.haftaraArticles, perushim: [] } },
				),
		);
		render(<ParashaSefer {...baseProps()} />);
		// Both scopes batch over the units except the current one.
		expect(mockSummariesBatch).toHaveBeenCalledWith("parasha", [2], "torah");
		expect(mockSummariesBatch).toHaveBeenCalledWith(
			"parasha",
			[2],
			"haftara",
		);
		await act(async () => {});
		expect(mockBlankPages.get("2:torah")?.perushim).toBe(
			currentUnitSummaries.perushim,
		);
		expect(mockBlankPages.get("2:haftara")?.articles).toBe(
			currentUnitSummaries.haftaraArticles,
		);
	});

	it("opens the current parasha's Torah text page on mount", () => {
		render(<ParashaSefer {...baseProps()} currentUnitId={2} />);
		// Unit 2's Torah text sits at page 7 → ceil(7 / 2) turned leaves.
		expect(capturedFlipBookProps.initialTurnedLeaves).toEqual([0, 1, 2, 3]);
	});

	it.each([
		["front", []],
		["toc", [0]],
		["back", [0, 1, 2, 3, 4, 5]],
	] as const)(
		"opens the book chrome %s page at its leaf",
		(page, expected) => {
			render(<ParashaSefer {...baseProps()} initialBookPage={page} />);
			expect(capturedFlipBookProps.initialTurnedLeaves).toEqual(expected);
		},
	);

	it("restores the requested page when it differs from the current page", () => {
		render(<ParashaSefer {...baseProps()} currentUnitId={2} />);
		expect(mockRestorePage).toHaveBeenCalledWith(7);
	});

	it("restores the Haftarah text page when the haftara flag is set", () => {
		render(<ParashaSefer {...baseProps()} currentUnitId={2} haftara />);
		expect(mockRestorePage).toHaveBeenCalledWith(9);
	});

	it("does not restore when the book already shows the requested page", () => {
		mockGetCurrentPageIndex.mockReturnValue(3);
		render(<ParashaSefer {...baseProps()} />);
		expect(mockRestorePage).not.toHaveBeenCalled();
	});

	it("seeds a content selection from an initial deep link", () => {
		render(
			<ParashaSefer
				{...baseProps()}
				initialContent={{ scope: "haftara", kind: "perush", slug: 'רד"ק' }}
			/>,
		);
		// The Haftarah blank of unit 1 restores the perush slug.
		expect(mockBlankPages.get("1:haftara")?.initialSlug).toBe('רד"ק');
		expect(mockBlankPages.get("1:torah")?.initialSlug).toBeUndefined();
	});

	it("routes blank-page navigation through the unit content history", () => {
		render(<ParashaSefer {...baseProps()} />);
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
		// The selection publishes back into the blank's restore slug.
		expect(mockBlankPages.get("1:torah")?.initialSlug).toBe('רש"י');
		// Clearing the selection drops only that scope's params.
		act(() => {
			onNavigate();
		});
		expect(window.location.search).not.toContain("perush=");
		expect(mockBlankPages.get("1:torah")?.initialSlug).toBeUndefined();
	});

	it("marks text pages for the facing blank's pasuk navigation", () => {
		render(<ParashaSefer {...baseProps()} />);
		// Each text section carries the pane key ({unitId}:{scope}) the
		// blank's open perush publishes against.
		const torahPage = document.querySelector(
			'[data-sefer-unit-text="1:torah"]',
		);
		const haftaraPage = document.querySelector(
			'[data-sefer-unit-text="1:haftara"]',
		);
		expect(torahPage).not.toBeNull();
		expect(haftaraPage).not.toBeNull();
	});

	it("resolves perek data and pasuk counts through the loaded map", () => {
		render(<ParashaSefer {...baseProps()} />);
		const [body] = mockUnitTextBodies;
		const pasukCount = body.pasukCount as (perekId: number) => number;
		const resolvePerek = body.resolvePerek as (
			perekId: number,
		) => { pesukim: unknown[]; source: string } | undefined;
		expect(pasukCount(1)).toBe(3);
		expect(pasukCount(335)).toBe(2);
		// A perek outside the loaded map counts a single pasuk so range
		// slices stay finite.
		expect(pasukCount(999)).toBe(1);
		expect(resolvePerek(1)).toEqual({
			pesukim: perek(3).pesukim,
			source: "בראשית א",
		});
		// A loaded perek without a recorded source falls back to "".
		expect(resolvePerek(335)).toEqual({
			pesukim: perek(2).pesukim,
			source: "",
		});
		expect(resolvePerek(999)).toBeUndefined();
	});

	it("wires TOC navigation, entry hrefs, and the contents filter", () => {
		render(<ParashaSefer {...baseProps()} />);
		const onNavigate = capturedTocProps.onNavigate as (idx: number) => void;
		act(() => onNavigate(3));
		expect(mockJumpToPage).toHaveBeenCalledWith(3);

		const getHref = capturedTocProps.getHref as (entry: {
			pageIndex: number;
			semanticName: string;
			title: string;
		}) => string | null;
		expect(getHref({ pageIndex: 0, semanticName: "", title: "" })).toBe(
			"/פרשה/בראשית/כריכה?book",
		);
		expect(getHref({ pageIndex: 2, semanticName: "", title: "" })).toBe(
			"/פרשה/בראשית/תוכן?book",
		);
		expect(
			getHref({ pageIndex: 3, semanticName: "א", title: "פרשת בראשית" }),
		).toBe("/פרשה/1?book");
		// The blank shares the Torah spread's route; the Haftarah spread
		// rides on &haftara.
		expect(
			getHref({ pageIndex: 4, semanticName: "", title: "" }),
		).toBe("/פרשה/1?book");
		expect(
			getHref({ pageIndex: 5, semanticName: "", title: "הפטרת בראשית" }),
		).toBe("/פרשה/1?book&haftara");
		expect(
			getHref({ pageIndex: 7, semanticName: "ב", title: "פרשת נח" }),
		).toBe("/פרשה/2?book");
		expect(getHref({ pageIndex: 11, semanticName: "", title: "" })).toBe(
			"/פרשה/בראשית/גב?book",
		);

		const filter = capturedTocProps.filter as (entry: {
			pageIndex: number;
			title: string;
		}) => boolean;
		expect(filter({ pageIndex: 2, title: "x" })).toBe(false);
		expect(filter({ pageIndex: 3, title: "" })).toBe(false);
		expect(filter({ pageIndex: 3, title: "פרשת בראשית" })).toBe(true);
	});

	it("lazy-loads the real FlipBook through the dynamic loader", async () => {
		render(<ParashaSefer {...baseProps()} />);
		const loader = (globalThis as Record<string, unknown>)
			.__parashaDynamicLoader as (() => Promise<{
			FlipBook?: unknown;
		}>) | null;
		expect(loader).not.toBeNull();
		if (!loader) {
			throw new Error("dynamic loader was not captured");
		}
		// The mocked html-flip-book-react has no FlipBook export; the real
		// bundle resolves it here.
		await expect(loader()).resolves.toBeUndefined();
	});

	it("opens and closes the bookshelf modal from the toolbar", () => {
		render(<ParashaSefer {...baseProps()} />);
		expect(screen.queryByTestId("mock-modal")).toBeNull();
		fireEvent.click(screen.getByLabelText('ספרי התנ"ך'));
		expect(screen.getByTestId("mock-modal")).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("close-modal"));
		expect(screen.queryByTestId("mock-modal")).toBeNull();
	});
});
