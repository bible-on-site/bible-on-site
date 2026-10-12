/**
 * @jest-environment jsdom
 *
 * Unit tests for ParashaSefer — the פרשה flipbook that lays a Torah
 * sefer out as parasha pages, each followed by its Haftarah variants.
 * The FlipBook, its toolbar, and the TOC come from html-flip-book-react
 * and are mocked here; the tests assert the props the component wires
 * (pages, semantics, history, toolbar actions) and the per-unit page
 * structure it renders.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";

let capturedFlipBookProps: Record<string, unknown> = {};
let capturedTocProps: Record<string, unknown> = {};
const mockUnitTextBodies: Array<Record<string, unknown>> = [];
const mockRestorePage = jest.fn();
const mockJumpToPage = jest.fn();
const mockGetCurrentPageIndex = jest.fn().mockReturnValue(0);

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
	initialBookPage: null as BookPage | null,
	haftara: false,
});

describe("ParashaSefer", () => {
	beforeEach(() => {
		capturedFlipBookProps = {};
		capturedTocProps = {};
		mockUnitTextBodies.length = 0;
		mockRestorePage.mockClear();
		mockJumpToPage.mockClear();
		mockGetCurrentPageIndex.mockReset().mockReturnValue(0);
	});

	it("lays out cover, contents, and one Torah + Haftarah page per parasha", () => {
		render(<ParashaSefer {...baseProps()} />);
		expect(screen.getByTestId("mock-flipbook")).toBeInTheDocument();
		expect(screen.getByTestId("mock-toc")).toBeInTheDocument();
		// cover + cover-interior + TOC + (units * 2) + back cover.
		const pages = capturedFlipBookProps.pages as React.ReactNode[];
		expect(pages).toHaveLength(3 + units.length * 2 + 1);
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

	it("opens the current parasha's page on mount", () => {
		render(<ParashaSefer {...baseProps()} currentUnitId={2} />);
		// Unit index 1 sits at page 5 → ceil(5 / 2) turned leaves.
		expect(capturedFlipBookProps.initialTurnedLeaves).toEqual([0, 1, 2]);
	});

	it.each([
		["front", []],
		["toc", [0]],
		["back", [0, 1, 2, 3]],
	] as const)(
		"opens the book chrome %s page at its leaf",
		(page, expected) => {
			render(<ParashaSefer {...baseProps()} initialBookPage={page} />);
			expect(capturedFlipBookProps.initialTurnedLeaves).toEqual(expected);
		},
	);

	it("restores the requested page when it differs from the current page", () => {
		render(<ParashaSefer {...baseProps()} currentUnitId={2} />);
		expect(mockRestorePage).toHaveBeenCalledWith(5);
	});

	it("restores the Haftarah page when the haftara flag is set", () => {
		render(<ParashaSefer {...baseProps()} currentUnitId={2} haftara />);
		expect(mockRestorePage).toHaveBeenCalledWith(6);
	});

	it("does not restore when the book already shows the requested page", () => {
		mockGetCurrentPageIndex.mockReturnValue(3);
		render(<ParashaSefer {...baseProps()} />);
		expect(mockRestorePage).not.toHaveBeenCalled();
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
		expect(
			getHref({ pageIndex: 4, semanticName: "", title: "הפטרת בראשית" }),
		).toBe("/פרשה/1?book&haftara");
		expect(getHref({ pageIndex: 7, semanticName: "", title: "" })).toBe(
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
