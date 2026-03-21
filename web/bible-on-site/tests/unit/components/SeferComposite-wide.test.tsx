/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/app/929/[number]/components/sefer-composite.module.css", () => ({
	seferOverlay: "seferOverlay",
	visible: "visible",
	hidden: "hidden",
	loadingContainer: "loadingContainer",
	loadingSpinner: "loadingSpinner",
}));

jest.mock("@/hooks/useIsWideEnough", () => ({
	TABLET_MIN_WIDTH: 768,
	useIsWideEnough: () => true,
}));

const mockGet = jest.fn().mockReturnValue(null);
const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
	useSearchParams: () => ({
		get: mockGet,
		toString: () => "",
	}),
	useRouter: () => ({ replace: mockReplace }),
	usePathname: () => "/929/5",
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

jest.mock("next/dynamic", () => {
	return (
		_loader: () => Promise<unknown>,
		opts?: { ssr?: boolean; loading?: () => React.ReactElement },
	) => {
		(globalThis as Record<string, unknown>).__capturedDynamicLoading = opts?.loading ?? null;
		return function MockSefer() {
			return <div data-testid="sefer" />;
		};
	};
});

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
		mockReplace.mockClear();
		localStorage.clear();
	});

	it("renders ReadModeToggler when wide enough", () => {
		render(<SeferComposite perekObj={minimalPerek} articles={[]} perushim={[]} />);
		expect(screen.getByRole("checkbox")).toBeTruthy();
	});

	it("shows Sefer view when toggled via checkbox", async () => {
		render(<SeferComposite perekObj={minimalPerek} articles={[]} perushim={[]} />);
		const checkbox = screen.getByRole("checkbox");

		await act(async () => {
			fireEvent.click(checkbox);
		});

		expect(mockReplace).toHaveBeenCalledWith("/929/5?book=", { scroll: false });
		expect(await screen.findByTestId("sefer")).toBeTruthy();
	});

	it("shows Sefer view immediately when ?book is in URL", async () => {
		mockGet.mockReturnValue("");
		await act(async () => {
			render(<SeferComposite perekObj={minimalPerek} articles={[]} perushim={[]} />);
		});
		expect(await screen.findByTestId("sefer")).toBeTruthy();
	});

	it("provides a loading indicator for the dynamic Sefer import", () => {
		render(<SeferComposite perekObj={minimalPerek} articles={[]} perushim={[]} />);
		const loadingFn = (globalThis as Record<string, unknown>).__capturedDynamicLoading as (() => React.ReactElement) | null;
		if (!loadingFn) throw new Error("expected loadingFn to be defined");
		const { container } = render(loadingFn());
		expect(
			container.querySelector('[aria-label="טוען תצוגת ספר..."]'),
		).toBeTruthy();
	});
});
