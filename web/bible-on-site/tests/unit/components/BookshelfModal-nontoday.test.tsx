/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * Separate test file for BookshelfModal when clicking a non-today sefer.
 * Uses a distinct jest.mock for getTodaysPerekId that returns 55 (שמות).
 */

jest.mock("@/app/components/Bookshelf/Bookshelf", () => ({
	Bookshelf: ({
		onSeferClick,
	}: { onSeferClick?: (name: string, from: number) => void }) => (
		<button
			data-testid="mock-bookshelf"
			type="button"
			onClick={() => onSeferClick?.("בראשית", 1)}
		>
			Bookshelf
		</button>
	),
}));

jest.mock("@/app/components/Bookshelf/bookshelf-modal.module.css", () => ({
	modal: "modal",
	content: "content",
	closeButton: "closeButton",
}));

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/hooks/useIsWideEnough", () => ({
	TABLET_MIN_WIDTH: 768,
	useIsWideEnough: () => false,
}));

// Today's perek is 55 (שמות), so clicking בראשית is non-today
jest.mock("@/data/perek-dto", () => ({
	getTodaysPerekId: () => 55,
}));

jest.mock("@/data/db/sefarim", () => ({
	sefarim: [
		{ name: "בראשית", perekFrom: 1, perekTo: 50 },
		{ name: "שמות", perekFrom: 51, perekTo: 90 },
	],
}));

import { BookshelfModal } from "@/app/components/Bookshelf/BookshelfModal";

beforeAll(() => {
	HTMLDialogElement.prototype.showModal = jest.fn();
	HTMLDialogElement.prototype.close = jest.fn();
});

describe("BookshelfModal (non-today sefer)", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("navigates to first perek when clicking a non-today sefer", () => {
		render(<BookshelfModal isOpen={true} onClose={jest.fn()} />);
		// Mock bookshelf fires onSeferClick("בראשית", 1) but today is שמות
		fireEvent.click(screen.getByTestId("mock-bookshelf"));
		expect(mockPush).toHaveBeenCalledWith("/929/1");
	});
});
