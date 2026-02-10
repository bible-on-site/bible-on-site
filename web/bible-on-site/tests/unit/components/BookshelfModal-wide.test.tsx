/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * Test that BookshelfModal appends ?book on wide screens.
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

// Wide screen → useIsWideEnough returns true
jest.mock("@/hooks/useIsWideEnough", () => ({
	TABLET_MIN_WIDTH: 768,
	useIsWideEnough: () => true,
}));

jest.mock("@/data/perek-dto", () => ({
	getTodaysPerekId: () => 5, // today = בראשית perek 5
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

describe("BookshelfModal (wide screen)", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("navigates to today's perek with ?book on wide screen", () => {
		render(<BookshelfModal isOpen={true} onClose={jest.fn()} />);
		fireEvent.click(screen.getByTestId("mock-bookshelf"));
		// Today is perek 5 (בראשית), wide screen → /929/5?book
		expect(mockPush).toHaveBeenCalledWith("/929/5?book");
	});
});
