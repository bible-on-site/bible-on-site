/**
 * Tests for the author articles datagrid: search, sefer filter, sorting
 * and row navigation.
 */

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush }),
}));

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
	}: {
		children: React.ReactNode;
		href: string;
	}) => <a href={href}>{children}</a>,
}));

jest.mock(
	"../../../src/app/929/authors/[authorParam]/author-articles-table.module.css",
	() => new Proxy({}, { get: (_, key) => String(key) }),
);

import { fireEvent, render, screen, within } from "@testing-library/react";
import { AuthorArticlesTable } from "../../../src/app/929/authors/[authorParam]/AuthorArticlesTable";
import type { AuthorArticleRow } from "../../../src/lib/authors/articles-grid";

const ROWS: AuthorArticleRow[] = [
	{
		id: 1,
		perekId: 10,
		name: "מאמר א",
		abstract: "תקציר ראשון",
		sefer: "בראשית",
		source: "בראשית א",
	},
	{
		id: 2,
		perekId: 20,
		name: "מאמר ב",
		abstract: null,
		sefer: "שמות",
		source: "שמות א",
	},
	{
		id: 3,
		perekId: 30,
		name: "מאמר ג",
		abstract: "תקציר שלישי",
		sefer: "בראשית",
		source: "בראשית ב",
	},
];

describe("AuthorArticlesTable", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("renders all rows with article links", () => {
		render(<AuthorArticlesTable rows={ROWS} />);
		expect(screen.getByRole("link", { name: "מאמר א" })).toHaveAttribute(
			"href",
			"/929/10/1",
		);
		expect(screen.getByText("מאמר ג")).toBeInTheDocument();
	});

	it("filters rows by the search input", () => {
		render(<AuthorArticlesTable rows={ROWS} />);
		fireEvent.change(screen.getByLabelText("חיפוש מאמר"), {
			target: { value: "שלישי" },
		});
		expect(screen.queryByText("מאמר א")).not.toBeInTheDocument();
		expect(screen.getByText("מאמר ג")).toBeInTheDocument();
	});

	it("filters rows by the sefer select", () => {
		render(<AuthorArticlesTable rows={ROWS} />);
		fireEvent.change(screen.getByLabelText("סינון לפי ספר"), {
			target: { value: "שמות" },
		});
		expect(screen.queryByText("מאמר א")).not.toBeInTheDocument();
		expect(screen.getByText("מאמר ב")).toBeInTheDocument();
	});

	it("shows the no-results row when nothing matches", () => {
		render(<AuthorArticlesTable rows={ROWS} />);
		fireEvent.change(screen.getByLabelText("חיפוש מאמר"), {
			target: { value: "zzz" },
		});
		expect(screen.getByText("לא נמצאו מאמרים תואמים")).toBeInTheDocument();
	});

	it("toggles sort direction on repeated column clicks", () => {
		render(<AuthorArticlesTable rows={ROWS} />);
		const nameHeader = screen.getByRole("columnheader", { name: /שם המאמר/ });
		expect(nameHeader).toHaveAttribute("aria-sort", "none");
		fireEvent.click(within(nameHeader).getByRole("button"));
		expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
		fireEvent.click(within(nameHeader).getByRole("button"));
		expect(nameHeader).toHaveAttribute("aria-sort", "descending");
	});

	it("navigates to the article when a row is clicked", () => {
		render(<AuthorArticlesTable rows={ROWS} />);
		fireEvent.click(screen.getByText("שמות א"));
		expect(mockPush).toHaveBeenCalledWith("/929/20/2");
	});
});
