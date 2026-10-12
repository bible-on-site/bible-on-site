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
let mockPathname = "/פרשה/5";
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
			haftara?: boolean;
			initialContent?: { scope: string; kind: string; slug: string } | null;
		}) {
			const [mount] = useState(() => ++mockSeferMountCount);
			return (
				<div
					data-testid="sefer"
					data-book-page={props.initialBookPage ?? "unit"}
					data-mount={mount}
					data-haftara={String(props.haftara)}
					data-initial-content={JSON.stringify(
						props.initialContent ?? null,
					)}
				/>
			);
		};
	};
});

import { ParashaSeferComposite } from "@/app/parasha/[unit]/components/ParashaSeferComposite";

describe("ParashaSeferComposite (wide screen)", () => {
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
		mockPathname = "/פרשה/5";
		mockReplace.mockClear();
		mockSeferMountCount = 0;
		localStorage.clear();
		delete document.documentElement.dataset.bookView;
		window.history.replaceState(null, "", "/פרשה/5");
	});

	it("keeps a pasuk citation visible despite a saved book preference", () => {
		localStorage.setItem("parashaViewMode", "book");
		window.history.replaceState(null, "", "/פרשה/5#pasuk-3-2");
		render(<ParashaSeferComposite {...props} />);
		expect(mockReplace).not.toHaveBeenCalled();
		expect(screen.queryByTestId("sefer")).toBeNull();
	});

	it("renders ReadModeToggler when wide enough", () => {
		render(<ParashaSeferComposite {...props} />);
		expect(screen.getByRole("checkbox")).toBeTruthy();
	});

	it("applies the stored book preference once", () => {
		localStorage.setItem("parashaViewMode", "book");
		render(<ParashaSeferComposite {...props} />);
		expect(mockReplace).toHaveBeenCalledWith("/פרשה/5?book=", {
			scroll: false,
		});
	});

	it("does not re-apply the preference when ?book is already present", () => {
		localStorage.setItem("parashaViewMode", "book");
		mockGet.mockImplementation((key: string) =>
			key === "book" ? "" : null,
		);
		render(<ParashaSeferComposite {...props} />);
		expect(mockReplace).not.toHaveBeenCalled();
		expect(localStorage.getItem("parashaViewMode")).toBe("book");
	});

	it("shows Sefer view when toggled via checkbox", async () => {
		render(<ParashaSeferComposite {...props} />);
		const checkbox = screen.getByRole("checkbox");

		await act(async () => {
			fireEvent.click(checkbox);
		});

		expect(mockReplace).toHaveBeenCalledWith("/פרשה/5?book=", {
			scroll: false,
		});
		expect(await screen.findByTestId("sefer")).toBeTruthy();
		expect(localStorage.getItem("parashaViewMode")).toBe("book");
		expect(document.documentElement).toHaveAttribute("data-book-view");
	});

	it("keeps a book opened before the initial passive effects visible", async () => {
		function OpenDuringHydration() {
			useLayoutEffect(() => {
				// Hydration can replay a user's click before the URL
				// initialization effect runs.
				screen.getByRole("checkbox").click();
			}, []);
			return <ParashaSeferComposite {...props} />;
		}

		await act(async () => {
			render(<OpenDuringHydration />);
		});

		expect(mockReplace).toHaveBeenCalledWith("/פרשה/5?book=", {
			scroll: false,
		});
		expect(await screen.findByTestId("sefer")).toBeVisible();
	});

	it("shows Sefer view immediately when ?book is in URL", async () => {
		mockGet.mockImplementation((key: string) =>
			key === "book" ? "" : null,
		);
		await act(async () => {
			render(<ParashaSeferComposite {...props} />);
		});
		expect(await screen.findByTestId("sefer")).toBeTruthy();
	});

	it("reopens an already mounted book after closing it", async () => {
		jest.useFakeTimers();
		try {
			render(<ParashaSeferComposite {...props} />);
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
			mockPathname = "/פרשה/בראשית/תוכן";
			mockGet.mockImplementation((key: string) =>
				key === "book" ? "" : null,
			);
			await act(async () => {
				render(<ParashaSeferComposite {...props} />);
			});
			await act(async () => {
				fireEvent.click(screen.getByRole("checkbox"));
			});
			act(() => jest.advanceTimersByTime(1000));
			expect(mockReplace).toHaveBeenCalledWith("/פרשה/5", {
				scroll: false,
			});
			expect(localStorage.getItem("parashaViewMode")).toBe("seo");
		} finally {
			jest.useRealTimers();
		}
	});

	it("passes the haftara flag through to the book", async () => {
		mockGet.mockImplementation((key: string) =>
			key === "book" ? "" : key === "haftara" ? "" : null,
		);
		await act(async () => {
			render(<ParashaSeferComposite {...props} />);
		});
		expect(
			(await screen.findByTestId("sefer")).getAttribute("data-haftara"),
		).toBe("true");
	});

	it("uses the bookPage query when the pathname is not a chrome route", async () => {
		mockGet.mockImplementation((key: string) =>
			key === "book" ? "" : key === "bookPage" ? "back" : null,
		);
		render(<ParashaSeferComposite {...props} />);
		expect(
			(await screen.findByTestId("sefer")).getAttribute("data-book-page"),
		).toBe("back");
	});

	it("uses the toc query when no bookPage is present", async () => {
		mockGet.mockImplementation((key: string) =>
			key === "book" ? "" : key === "toc" ? "" : null,
		);
		render(<ParashaSeferComposite {...props} />);
		expect(
			(await screen.findByTestId("sefer")).getAttribute("data-book-page"),
		).toBe("toc");
	});

	it("provides a loading indicator for the dynamic Sefer import", () => {
		render(<ParashaSeferComposite {...props} />);
		const loadingFn = (globalThis as Record<string, unknown>)
			.__capturedDynamicLoading as (() => React.ReactElement) | null;
		if (!loadingFn) throw new Error("expected loadingFn to be defined");
		const { container } = render(loadingFn());
		expect(
			container.querySelector('[aria-label="טוען תצוגת ספר..."]'),
		).toBeTruthy();
	});

	it.each([
		["haftaraPerush", 'רד"ק', { scope: "haftara", kind: "perush", slug: 'רד"ק' }],
		["haftaraArticle", "haft-article", { scope: "haftara", kind: "article", slug: "haft-article" }],
		["perush", 'רש"י', { scope: "torah", kind: "perush", slug: 'רש"י' }],
		["article", "torah-article", { scope: "torah", kind: "article", slug: "torah-article" }],
	] as const)(
		"seeds a %s deep link into the book",
		async (param, slug, expected) => {
			mockGet.mockImplementation((key: string) =>
				key === "book" ? "" : key === param ? slug : null,
			);
			render(<ParashaSeferComposite {...props} />);
			expect(
				JSON.parse(
					(await screen.findByTestId("sefer")).getAttribute(
						"data-initial-content",
					) as string,
				),
			).toEqual(expected);
		},
	);

	it("prefers the Haftarah scope when both scopes carry content", async () => {
		mockGet.mockImplementation((key: string) =>
			key === "book"
				? ""
				: key === "haftaraPerush"
					? 'רד"ק'
					: key === "perush"
						? 'רש"י'
						: null,
		);
		render(<ParashaSeferComposite {...props} />);
		expect(
			JSON.parse(
				(await screen.findByTestId("sefer")).getAttribute(
					"data-initial-content",
				) as string,
			),
		).toEqual({ scope: "haftara", kind: "perush", slug: 'רד"ק' });
	});
});
