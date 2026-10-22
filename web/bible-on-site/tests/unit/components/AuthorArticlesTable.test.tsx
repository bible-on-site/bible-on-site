/** Row-click navigation behavior of the author articles datagrid. */

const push = jest.fn();
jest.mock("next/navigation", () => ({
	useRouter: () => ({ push }),
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { AuthorArticlesTable } from "../../../src/app/929/authors/[authorParam]/AuthorArticlesTable";
import type { AuthorArticleRow } from "../../../src/lib/authors/articles-grid";

const ROWS: AuthorArticleRow[] = [
	{
		id: 10,
		name: "מאמר ראשון",
		perekId: 5,
		sefer: "בראשית",
		source: "בראשית א",
		abstract: "תקציר ראשון",
	},
	{
		id: 11,
		name: "מאמר שני",
		perekId: 6,
		sefer: "שמות",
		source: "שמות ב",
		abstract: "תקציר שני",
	},
];

describe("AuthorArticlesTable", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe("when a row is clicked", () => {
		it("navigates to the article", () => {
			render(<AuthorArticlesTable rows={ROWS} />);

			fireEvent.click(screen.getByText("תקציר שני"));

			expect(push).toHaveBeenCalledWith("/929/6/11");
		});

		it("does not navigate when the name link is clicked", () => {
			render(<AuthorArticlesTable rows={ROWS} />);

			fireEvent.click(screen.getByText("מאמר שני"));

			expect(push).not.toHaveBeenCalled();
		});

		it("does not navigate while text is selected", () => {
			render(<AuthorArticlesTable rows={ROWS} />);
			const selection = window.getSelection();
			const range = document.createRange();
			range.selectNodeContents(screen.getByText("תקציר שני"));
			selection?.addRange(range);
			expect(selection?.isCollapsed).toBe(false);

			fireEvent.click(screen.getByText("תקציר שני"));

			expect(push).not.toHaveBeenCalled();
			selection?.removeAllRanges();
		});
	});
});
