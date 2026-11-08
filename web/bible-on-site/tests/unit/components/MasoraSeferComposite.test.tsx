/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";

jest.mock("@/app/929/[number]/components/sefer-composite.module.css", () => ({
	seferOverlay: "seferOverlay",
	visible: "visible",
	hidden: "hidden",
	loadingContainer: "loadingContainer",
	loadingSpinner: "loadingSpinner",
}));

jest.mock("@/hooks/useIsWideEnough", () => ({
	TABLET_MIN_WIDTH: 768,
	useIsWideEnough: () => false,
}));

const mockGet = jest.fn().mockReturnValue(null);
const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
	useSearchParams: () => ({
		get: mockGet,
		toString: () => "",
	}),
	useRouter: () => ({ replace: mockReplace }),
	usePathname: () => "/מסורה/5",
}));

jest.mock("next/dynamic", () => () => () => <div data-testid="sefer" />);

jest.mock("@/app/929/[number]/components/ReadModeToggler", () => ({
	__esModule: true,
	default: () => <div data-testid="read-mode-toggler" />,
}));

import { MasoraSeferComposite } from "@/app/masora/[unit]/components/MasoraSeferComposite";

describe("MasoraSeferComposite", () => {
	const props = {
		units: [],
		seferName: "בראשית",
		currentUnitId: 5,
		entityRefsByPerek: {},
		perekSources: {},
		articles: [],
		perushim: [],
	};

	beforeEach(() => {
		mockGet.mockReturnValue(null);
		delete document.documentElement.dataset.bookView;
		localStorage.clear();
		window.history.replaceState(null, "", "/מסורה/5");
	});

	it("returns null when viewport is not wide enough", () => {
		const { container } = render(<MasoraSeferComposite {...props} />);
		expect(container.firstChild).toBeNull();
	});

	it("keeps masora text visible on phones even when a link requests book view", () => {
		mockGet.mockImplementation((key: string) =>
			key === "book" ? "" : null,
		);
		render(<MasoraSeferComposite {...props} />);
		expect(document.documentElement).not.toHaveAttribute("data-book-view");
		// The toggled effect still reaffirms the stored preference.
		expect(localStorage.getItem("masoraViewMode")).toBe("book");
	});
});
