/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/app/components/Bookshelf", () => ({
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

jest.mock("@/app/bookshelf/page.module.css", () => ({
	page: "page",
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
	getTodaysPerekId: () => 5,
}));

jest.mock("@/data/db/sefarim", () => ({
	sefarim: [
		{ name: "בראשית", perekFrom: 1, perekTo: 50 },
		{ name: "שמות", perekFrom: 51, perekTo: 90 },
	],
}));

import BookshelfPage from "@/app/bookshelf/page";

describe("BookshelfPage (wide screen)", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("navigates to today's perek with ?book on wide screen", () => {
		render(<BookshelfPage />);
		fireEvent.click(screen.getByTestId("mock-bookshelf"));
		// Today is perek 5 (בראשית), wide screen → /929/5?book
		expect(mockPush).toHaveBeenCalledWith("/929/5?book");
	});
});
