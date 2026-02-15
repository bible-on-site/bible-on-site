/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * Separate test file for BookshelfModal when clicking a non-today sefer.
 * The Bookshelf component passes perekFrom for non-today sefarim.
 */

// Mock Bookshelf: clicking passes perekFrom for a non-today sefer
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

// perek-dto and sefarim mocks no longer needed — Bookshelf handles todaysPerekId

import { BookshelfModal } from "@/app/components/Bookshelf/BookshelfModal";

beforeAll(() => {
	HTMLDialogElement.prototype.showModal = jest.fn();
	HTMLDialogElement.prototype.close = jest.fn();
});

describe("BookshelfModal (non-today sefer)", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("navigates to perekFrom when clicking a non-today sefer", () => {
		render(<BookshelfModal isOpen={true} onClose={jest.fn()} />);
		// Mock bookshelf fires onSeferClick("בראשית", 1) — Bookshelf passed perekFrom
		fireEvent.click(screen.getByTestId("mock-bookshelf"));
		expect(mockPush).toHaveBeenCalledWith("/929/1");
	});
});
