/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";

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

jest.mock("@/data/db/sefarim", () => ({
	sefarim: [
		{ name: "בראשית", helek: "תורה", perekFrom: 1, perekTo: 50 },
	],
}));

// Return a perek ID that doesn't match any sefer range → todaySeferName = ""
jest.mock("@/data/perek-dto", () => ({
	getTodaysPerekId: () => 999,
}));

jest.mock("@/data/sefer-colors", () => ({
	isTreiAsar: () => false,
}));

import { Bookshelf } from "@/app/components/Bookshelf/Bookshelf";

describe("Bookshelf (no today sefer)", () => {
	it("renders without bookmark ribbon when today's perek matches no sefer", () => {
		Object.defineProperty(window, "innerWidth", {
			value: 800,
			writable: true,
			configurable: true,
		});

		const { container } = render(<Bookshelf />);
		// No bookmarkRibbon div should be rendered
		expect(container.innerHTML).not.toContain("bookmarkRibbon");
	});
});
