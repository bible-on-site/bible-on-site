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
	usePathname: () => "/פרשה/חיי-שרה",
}));

jest.mock("next/dynamic", () => () => () => <div data-testid="sefer" />);

jest.mock("@/app/929/[number]/components/ReadModeToggler", () => ({
	__esModule: true,
	default: () => <div data-testid="read-mode-toggler" />,
}));

import { ParashaSeferComposite } from "@/app/parasha/[unit]/components/ParashaSeferComposite";

describe("ParashaSeferComposite", () => {
	const props = {
		units: [],
		seferName: "בראשית",
		currentUnitId: 5,
		entityRefsByPerek: {},
		perekSources: {},
		articles: [],
		perushim: [],
		haftaraArticles: [],
		haftaraPerushim: [],
	};

	beforeEach(() => {
		mockGet.mockReturnValue(null);
		delete document.documentElement.dataset.bookView;
		localStorage.clear();
		window.history.replaceState(null, "", "/פרשה/חיי-שרה");
	});

	it("returns null when viewport is not wide enough", () => {
		const { container } = render(<ParashaSeferComposite {...props} />);
		expect(container.firstChild).toBeNull();
	});

	it("keeps parasha text visible on phones even when a link requests book view", () => {
		mockGet.mockImplementation((key: string) =>
			key === "book" ? "" : null,
		);
		render(<ParashaSeferComposite {...props} />);
		expect(document.documentElement).not.toHaveAttribute("data-book-view");
		// The toggled effect still reaffirms the stored preference.
		expect(localStorage.getItem("parashaViewMode")).toBe("book");
	});
});
