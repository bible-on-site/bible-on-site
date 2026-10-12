/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect, useState } from "react";

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
let mockPathname = "/מסורה/5";
let mockSeferMountCount = 0;
jest.mock("next/navigation", () => ({
	useSearchParams: () => ({
		get: mockGet,
		toString: () => "",
	}),
	useRouter: () => ({ replace: mockReplace }),
	usePathname: () => mockPathname,
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
		(globalThis as Record<string, unknown>).__capturedDynamicLoading =
			opts?.loading ?? null;
		return function MockSefer(props: {
			initialBookPage?: string | null;
		}) {
			const [mount] = useState(() => ++mockSeferMountCount);
			return (
				<div
					data-testid="sefer"
					data-book-page={props.initialBookPage ?? "unit"}
					data-mount={mount}
				/>
			);
		};
	};
});

import { MasoraSeferComposite } from "@/app/masora/[unit]/components/MasoraSeferComposite";

describe("MasoraSeferComposite (wide screen)", () => {
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
		mockPathname = "/מסורה/5";
		mockReplace.mockClear();
		mockSeferMountCount = 0;
		localStorage.clear();
		delete document.documentElement.dataset.bookView;
		window.history.replaceState(null, "", "/מסורה/5");
	});

	it("keeps a pasuk citation visible despite a saved book preference", () => {
		localStorage.setItem("masoraViewMode", "book");
		window.history.replaceState(null, "", "/מסורה/5#pasuk-3-2");
		render(<MasoraSeferComposite {...props} />);
		expect(mockReplace).not.toHaveBeenCalled();
		expect(screen.queryByTestId("sefer")).toBeNull();
	});

	it("renders ReadModeToggler when wide enough", () => {
		render(<MasoraSeferComposite {...props} />);
		expect(screen.getByRole("checkbox")).toBeTruthy();
	});

	it("applies the stored book preference once", () => {
		localStorage.setItem("masoraViewMode", "book");
		render(<MasoraSeferComposite {...props} />);
		expect(mockReplace).toHaveBeenCalledWith("/מסורה/5?book=", {
			scroll: false,
		});
	});

	it("does not re-apply the preference when ?book is already present", () => {
		localStorage.setItem("masoraViewMode", "book");
		mockGet.mockImplementation((key: string) =>
			key === "book" ? "" : null,
		);
		render(<MasoraSeferComposite {...props} />);
		expect(mockReplace).not.toHaveBeenCalled();
		expect(localStorage.getItem("masoraViewMode")).toBe("book");
	});

	it("shows Sefer view when toggled via checkbox", async () => {
		render(<MasoraSeferComposite {...props} />);
		const checkbox = screen.getByRole("checkbox");

		await act(async () => {
			fireEvent.click(checkbox);
		});

		expect(mockReplace).toHaveBeenCalledWith("/מסורה/5?book=", {
			scroll: false,
		});
		expect(await screen.findByTestId("sefer")).toBeTruthy();
		expect(localStorage.getItem("masoraViewMode")).toBe("book");
		expect(document.documentElement).toHaveAttribute("data-book-view");
	});

	it("keeps a book opened before the initial passive effects visible", async () => {
		function OpenDuringHydration() {
			useLayoutEffect(() => {
				// Hydration can replay a user's click before the URL
				// initialization effect runs.
				screen.getByRole("checkbox").click();
			}, []);
			return <MasoraSeferComposite {...props} />;
		}

		await act(async () => {
			render(<OpenDuringHydration />);
		});

		expect(mockReplace).toHaveBeenCalledWith("/מסורה/5?book=", {
			scroll: false,
		});
		expect(await screen.findByTestId("sefer")).toBeVisible();
	});

	it("shows Sefer view immediately when ?book is in URL", async () => {
		mockGet.mockImplementation((key: string) =>
			key === "book" ? "" : null,
		);
		await act(async () => {
			render(<MasoraSeferComposite {...props} />);
		});
		expect(await screen.findByTestId("sefer")).toBeTruthy();
	});

	it("reopens an already mounted book after closing it", async () => {
		jest.useFakeTimers();
		try {
			render(<MasoraSeferComposite {...props} />);
			const toggle = screen.getByRole("checkbox");
			await act(async () => {
				fireEvent.click(toggle);
			});
			const book = await screen.findByTestId("sefer");
			const mount = book.getAttribute("data-mount");
			fireEvent.click(toggle);
			act(() => jest.advanceTimersByTime(1000));
			await act(async () => {
				fireEvent.click(toggle);
			});
			expect(screen.getByTestId("sefer")).toBeVisible();
			expect(screen.getByTestId("sefer").getAttribute("data-mount")).toBe(
				mount,
			);
		} finally {
			jest.useRealTimers();
		}
	});

	it("untoggles back to the unit page from a book-chrome route", async () => {
		jest.useFakeTimers();
		try {
			mockPathname = "/מסורה/1/תוכן";
			mockGet.mockImplementation((key: string) =>
				key === "book" ? "" : null,
			);
			await act(async () => {
				render(<MasoraSeferComposite {...props} />);
			});
			await act(async () => {
				fireEvent.click(screen.getByRole("checkbox"));
			});
			act(() => jest.advanceTimersByTime(1000));
			expect(mockReplace).toHaveBeenCalledWith("/מסורה/5", {
				scroll: false,
			});
			expect(localStorage.getItem("masoraViewMode")).toBe("seo");
		} finally {
			jest.useRealTimers();
		}
	});

	it("uses the bookPage query when the pathname is not a chrome route", async () => {
		mockGet.mockImplementation((key: string) =>
			key === "book" ? "" : key === "bookPage" ? "back" : null,
		);
		render(<MasoraSeferComposite {...props} />);
		expect(
			(await screen.findByTestId("sefer")).getAttribute("data-book-page"),
		).toBe("back");
	});

	it("uses the toc query when no bookPage is present", async () => {
		mockGet.mockImplementation((key: string) =>
			key === "book" ? "" : key === "toc" ? "" : null,
		);
		render(<MasoraSeferComposite {...props} />);
		expect(
			(await screen.findByTestId("sefer")).getAttribute("data-book-page"),
		).toBe("toc");
	});

	it("provides a loading indicator for the dynamic Sefer import", () => {
		render(<MasoraSeferComposite {...props} />);
		const loadingFn = (globalThis as Record<string, unknown>)
			.__capturedDynamicLoading as (() => React.ReactElement) | null;
		if (!loadingFn) throw new Error("expected loadingFn to be defined");
		const { container } = render(loadingFn());
		expect(
			container.querySelector('[aria-label="טוען תצוגת ספר..."]'),
		).toBeTruthy();
	});
});
