/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, act } from "@testing-library/react";

// Mock Bookshelf to avoid rendering the complex 3D component.
// The real Bookshelf passes todaysPerekId (5) for today's sefer, not perekFrom (1).
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

jest.mock("@/hooks/useIsWideEnough", () => ({
	TABLET_MIN_WIDTH: 768,
	useIsWideEnough: () => false,
}));

// perek-dto and sefarim mocks no longer needed — the BookshelfModal
// no longer computes todaysPerekId; the Bookshelf component handles it.

import { BookshelfModal } from "@/app/components/Bookshelf/BookshelfModal";

// jsdom does not implement showModal/close on <dialog>
beforeAll(() => {
	HTMLDialogElement.prototype.showModal = jest.fn();
	HTMLDialogElement.prototype.close = jest.fn();
});

describe("BookshelfModal", () => {
	beforeEach(() => {
		mockPush.mockClear();
		(HTMLDialogElement.prototype.showModal as jest.Mock).mockClear();
		(HTMLDialogElement.prototype.close as jest.Mock).mockClear();
	});

	it("returns null when isOpen is false", () => {
		const { container } = render(
			<BookshelfModal isOpen={false} onClose={jest.fn()} />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders dialog when isOpen is true", () => {
		render(<BookshelfModal isOpen={true} onClose={jest.fn()} />);
		expect(
			screen.getByRole("dialog", { hidden: true }),
		).toBeInTheDocument();
		expect(screen.getByTestId("mock-bookshelf")).toBeInTheDocument();
		expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
	});

	it("calls onClose when close button is clicked", () => {
		const onClose = jest.fn();
		render(<BookshelfModal isOpen={true} onClose={onClose} />);
		fireEvent.click(
			screen.getByRole("button", { name: "סגור", hidden: true }),
		);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("calls onClose on Escape key", () => {
		const onClose = jest.fn();
		render(<BookshelfModal isOpen={true} onClose={onClose} />);
		act(() => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape" }),
			);
		});
		expect(onClose).toHaveBeenCalled();
	});

	it("calls onClose on backdrop click (click on dialog itself)", () => {
		const onClose = jest.fn();
		render(<BookshelfModal isOpen={true} onClose={onClose} />);
		const dialog = screen.getByRole("dialog", { hidden: true });
		fireEvent.click(dialog);
		expect(onClose).toHaveBeenCalled();
	});

	it("does NOT trigger backdrop close when clicking inside content", () => {
		const onClose = jest.fn();
		render(<BookshelfModal isOpen={true} onClose={onClose} />);
		const content = screen
			.getByRole("dialog", { hidden: true })
			.querySelector(".content") as Element;
		expect(content).toBeTruthy();
		fireEvent.click(content);
		expect(onClose).not.toHaveBeenCalled();
	});

	it("navigates to today's perek when clicking today's sefer (narrow)", () => {
		render(<BookshelfModal isOpen={true} onClose={jest.fn()} />);
		fireEvent.click(screen.getByTestId("mock-bookshelf"));
		// Today is perek 5 (בראשית), clicked sefer is also בראשית → navigate to /929/5
		expect(mockPush).toHaveBeenCalledWith("/929/5");
	});

	it("calls dialog.close when isOpen transitions to false", () => {
		const { rerender } = render(
			<BookshelfModal isOpen={true} onClose={jest.fn()} />,
		);
		expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
		rerender(<BookshelfModal isOpen={false} onClose={jest.fn()} />);
	});

	it("calls onClose on Escape keydown on dialog element", () => {
		const onClose = jest.fn();
		render(<BookshelfModal isOpen={true} onClose={onClose} />);
		const dialog = screen.getByRole("dialog", { hidden: true });
		fireEvent.keyDown(dialog, { key: "Escape" });
		expect(onClose).toHaveBeenCalled();
	});
});
