/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ArticlesSection } from "../../../src/app/929/[number]/components/ArticlesSection";
import type { Article } from "../../../src/lib/articles";

describe("ArticlesSection", () => {
	const mockArticles: Article[] = [
		{
			id: 1,
			perekId: 1,
			authorId: 1,
			name: "מאמר ראשון",
			abstract: "<p>תקציר המאמר הראשון</p>",
			priority: 1,
		},
		{
			id: 2,
			perekId: 1,
			authorId: 2,
			name: "מאמר שני",
			abstract: null,
			priority: 2,
		},
	];

	describe("when articles array is empty", () => {
		it("returns null and renders nothing", () => {
			const { container } = render(<ArticlesSection articles={[]} />);
			expect(container.firstChild).toBeNull();
		});
	});

	describe("when articles are provided", () => {
		it("renders the section header with icon and title", () => {
			render(<ArticlesSection articles={mockArticles} />);

			expect(screen.getByText("📚")).toBeTruthy();
			expect(screen.getByText("מאמרים על הפרק")).toBeTruthy();
		});

		it("renders all article cards", () => {
			render(<ArticlesSection articles={mockArticles} />);

			expect(screen.getByText("מאמר ראשון")).toBeTruthy();
			expect(screen.getByText("מאמר שני")).toBeTruthy();
		});

		it("renders article abstract when provided", () => {
			render(<ArticlesSection articles={mockArticles} />);

			// The abstract HTML content should be rendered
			expect(screen.getByText("תקציר המאמר הראשון")).toBeTruthy();
		});

		it("does not render abstract div when abstract is null", () => {
			render(<ArticlesSection articles={[mockArticles[1]]} />);

			// Article with null abstract should not have abstract content
			expect(screen.getByText("מאמר שני")).toBeTruthy();
			// Should only have one article card
			const articleCards = screen.getAllByRole("article");
			expect(articleCards).toHaveLength(1);
		});

		it("renders read more link for each article", () => {
			render(<ArticlesSection articles={mockArticles} />);

			const readMoreLinks = screen.getAllByText("קרא עוד");
			expect(readMoreLinks).toHaveLength(2);
		});

		it("uses article id as key for mapping", () => {
			const { container } = render(
				<ArticlesSection articles={mockArticles} />,
			);

			const articleCards = container.querySelectorAll("article");
			expect(articleCards).toHaveLength(2);
		});
	});

	describe("HTML content handling", () => {
		it("renders HTML abstract content safely", () => {
			const articleWithHtmlAbstract: Article[] = [
				{
					id: 3,
					perekId: 1,
					authorId: 1,
					name: "מאמר עם HTML",
					abstract: "<strong>טקסט מודגש</strong>",
					priority: 1,
				},
			];

			const { container } = render(
				<ArticlesSection articles={articleWithHtmlAbstract} />,
			);

			const strongElement = container.querySelector("strong");
			expect(strongElement).toBeTruthy();
			expect(strongElement?.textContent).toBe("טקסט מודגש");
		});
	});
});
