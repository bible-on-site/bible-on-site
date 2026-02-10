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

jest.mock("@/hooks/useIsWideEnough", () => ({
	TABLET_MIN_WIDTH: 768,
	useIsWideEnough: () => false,
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

describe("BookshelfPage", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("renders bookshelf component", () => {
		render(<BookshelfPage />);
		expect(screen.getByTestId("mock-bookshelf")).toBeInTheDocument();
	});

	it("navigates to today's perek when clicking today's sefer (narrow)", () => {
		render(<BookshelfPage />);
		fireEvent.click(screen.getByTestId("mock-bookshelf"));
		// Today is perek 5 (בראשית), clicked sefer is בראשית → /929/5
		expect(mockPush).toHaveBeenCalledWith("/929/5");
	});
});
