/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/app/components/Bookshelf/bookshelf.module.scss", () => ({
	root: "root",
	multiShelfContainer: "multiShelfContainer",
	shelfWrapper: "shelfWrapper",
	container: "container",
	surface: "surface",
	block: "block",
	book: "book",
	blockInner: "blockInner",
	back: "back",
	bottom: "bottom",
	front: "front",
	left: "left",
	right: "right",
	top: "top",
	spineText: "spineText",
	bookmarkRibbon: "bookmarkRibbon",
	coverContent: "coverContent",
	coverTitle: "coverTitle",
	coverSubtitle: "coverSubtitle",
	shelfLabel: "shelfLabel",
}));

// Minimal sefarim covering all helek groups (Torah, Neviim Rishonim, Trei Asar, Ketuvim)
jest.mock("@/data/db/sefarim", () => ({
	sefarim: [
		{ name: "בראשית", helek: "תורה", perekFrom: 1, perekTo: 50 },
		{ name: "שמות", helek: "תורה", perekFrom: 51, perekTo: 90 },
		{ name: "יהושע", helek: "נביאים", perekFrom: 91, perekTo: 120 },
		{ name: "עמוס", helek: "נביאים", perekFrom: 121, perekTo: 130 },
		{ name: "תהלים", helek: "כתובים", perekFrom: 131, perekTo: 180 },
	],
}));

jest.mock("@/data/perek-dto", () => ({
	getTodaysPerekId: () => 5, // within בראשית (1-50)
}));

jest.mock("@/data/sefer-colors", () => ({
	isTreiAsar: (name: string) => name === "עמוס",
}));

import { Bookshelf } from "@/app/components/Bookshelf/Bookshelf";

describe("Bookshelf", () => {
	const originalInnerWidth = window.innerWidth;

	afterEach(() => {
		Object.defineProperty(window, "innerWidth", {
			value: originalInnerWidth,
			writable: true,
			configurable: true,
		});
	});

	describe("when narrow (multi-shelf layout)", () => {
		beforeEach(() => {
			Object.defineProperty(window, "innerWidth", {
				value: 800,
				writable: true,
				configurable: true,
			});
		});

		it("renders all sefer names", () => {
			render(<Bookshelf />);
			for (const name of ["בראשית", "שמות", "יהושע", "עמוס", "תהלים"]) {
				// Each name appears on the spine and the cover
				expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(1);
			}
		});

		it("renders per-helek shelf labels", () => {
			render(<Bookshelf />);
			expect(screen.getByText("תורה")).toBeInTheDocument();
			expect(
				screen.getByText("נביאים: ראשונים + גדולים"),
			).toBeInTheDocument();
			expect(
				screen.getByText("נביאים (המשך): תרי עשר"),
			).toBeInTheDocument();
			expect(screen.getByText("כתובים")).toBeInTheDocument();
		});

		it("calls onSeferClick with sefer name and perekFrom when a book is clicked", () => {
			const onSeferClick = jest.fn();
			render(<Bookshelf onSeferClick={onSeferClick} />);
			const buttons = screen.getAllByRole("button");
			fireEvent.click(buttons[0]);
			expect(onSeferClick).toHaveBeenCalledTimes(1);
			// The callback receives (seferName, perekFrom)
			expect(onSeferClick).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Number),
			);
		});

		it("renders today's sefer with a bookmark ribbon", () => {
			const { container } = render(<Bookshelf />);
			// Today's perekId 5 falls in בראשית → bookmarkRibbon class should appear
			// The Proxy mock maps styles.bookmarkRibbon → "bookmarkRibbon" in the DOM
			expect(container.innerHTML).toContain("bookmarkRibbon");
		});
	});

	describe("when wide (single-shelf layout)", () => {
		beforeEach(() => {
			Object.defineProperty(window, "innerWidth", {
				value: 1200,
				writable: true,
				configurable: true,
			});
		});

		it("renders all sefer names on a single shelf", () => {
			render(<Bookshelf />);
			for (const name of ["בראשית", "שמות", "יהושע", "עמוס", "תהלים"]) {
				expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(1);
			}
		});

		it("renders combined helek labels (נביאים without sub-group suffix)", () => {
			render(<Bookshelf />);
			// Single-shelf mode has simple helek labels
			expect(screen.getByText("נביאים")).toBeInTheDocument();
			expect(screen.getByText("תורה")).toBeInTheDocument();
			expect(screen.getByText("כתובים")).toBeInTheDocument();
		});
	});

	it("responds to window resize events", () => {
		Object.defineProperty(window, "innerWidth", {
			value: 1200,
			writable: true,
			configurable: true,
		});

		render(<Bookshelf />);
		// Initially wide → single shelf → "נביאים" label (no sub-group suffix)
		expect(screen.getByText("נביאים")).toBeInTheDocument();

		act(() => {
			Object.defineProperty(window, "innerWidth", {
				value: 800,
				writable: true,
				configurable: true,
			});
			window.dispatchEvent(new Event("resize"));
		});

		// After resize → narrow → multi-shelf labels appear
		expect(
			screen.getByText("נביאים: ראשונים + גדולים"),
		).toBeInTheDocument();
	});
});
