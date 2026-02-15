/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * Test that BookshelfModal appends ?book on wide screens.
 */

// The real Bookshelf passes todaysPerekId (5) for today's sefer
jest.mock("@/app/components/Bookshelf/Bookshelf", () => ({
	Bookshelf: ({
		onSeferClick,
	}: { onSeferClick?: (name: string, from: number) => void }) => (
		<button
			data-testid="mock-bookshelf"
			type="button"
			onClick={() => onSeferClick?.("בראשית", 5)}
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

// perek-dto and sefarim mocks no longer needed — Bookshelf handles todaysPerekId

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
