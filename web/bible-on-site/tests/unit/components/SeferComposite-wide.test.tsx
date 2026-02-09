/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react";

jest.mock("@/app/929/[number]/components/sefer-composite.module.css", () => ({
	seferOverlay: "seferOverlay",
	visible: "visible",
	hidden: "hidden",
}));

jest.mock("@/hooks/useIsWideEnough", () => ({
	TABLET_MIN_WIDTH: 768,
	useIsWideEnough: () => true,
}));

const mockGet = jest.fn().mockReturnValue(null);
jest.mock("next/navigation", () => ({
	useSearchParams: () => ({ get: mockGet }),
}));

jest.mock("next/image", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => (
		<span data-testid="mock-image" data-alt={props.alt as string} />
	),
}));

jest.mock("@/app/929/[number]/components/read-mode-toggler.module.css", () => ({
	label: "label",
	input: "input",
	toggleDiv: "toggleDiv",
	bookIcon: "bookIcon",
	noteIcon: "noteIcon",
}));

jest.mock("@/app/929/[number]/components/Sefer", () => ({
	__esModule: true,
	default: () => <div data-testid="sefer" />,
}));

import SeferComposite from "@/app/929/[number]/components/SeferComposite";

describe("SeferComposite (wide screen)", () => {
	const minimalPerek = {
		perekId: 5,
		perekHeb: "ה",
		header: "בראשית ה",
		helek: "תורה",
		sefer: "בראשית",
		source: "mechon-mamre" as const,
		pesukim: [],
	};

	beforeEach(() => {
		mockGet.mockReturnValue(null);
	});

	it("renders ReadModeToggler when wide enough", () => {
		render(<SeferComposite perekObj={minimalPerek} articles={[]} />);
		expect(screen.getByRole("checkbox")).toBeTruthy();
	});

	it("shows Sefer view when toggled via checkbox", () => {
		render(<SeferComposite perekObj={minimalPerek} articles={[]} />);
		const checkbox = screen.getByRole("checkbox");

		act(() => {
			fireEvent.click(checkbox);
		});

		expect(screen.getByTestId("sefer")).toBeTruthy();
	});

	it("shows Sefer view immediately when ?book is in URL", () => {
		mockGet.mockReturnValue("");
		render(<SeferComposite perekObj={minimalPerek} articles={[]} />);
		expect(screen.getByTestId("sefer")).toBeTruthy();
	});
});
