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
			authorName: "הרב ישראל",
			authorImageUrl: "https://test.s3.amazonaws.com/authors/high-res/1.jpg",
		},
		{
			id: 2,
			perekId: 1,
			authorId: 2,
			name: "מאמר שני",
			abstract: null,
			priority: 2,
			authorName: "הרב יעקב",
			authorImageUrl: "https://test.s3.amazonaws.com/authors/high-res/2.jpg",
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

		it("renders all article titles", () => {
			render(<ArticlesSection articles={mockArticles} />);

			expect(screen.getByText("מאמר ראשון")).toBeTruthy();
			expect(screen.getByText("מאמר שני")).toBeTruthy();
		});

		it("renders author names", () => {
			render(<ArticlesSection articles={mockArticles} />);

			expect(screen.getByText("הרב ישראל")).toBeTruthy();
			expect(screen.getByText("הרב יעקב")).toBeTruthy();
		});

		it("renders author images", () => {
			render(<ArticlesSection articles={mockArticles} />);

			const images = screen.getAllByRole("img");
			expect(images).toHaveLength(2);
			expect(images[0]).toHaveAttribute("alt", "הרב ישראל");
			expect(images[1]).toHaveAttribute("alt", "הרב יעקב");
		});

		it("renders article abstract when provided", () => {
			render(<ArticlesSection articles={mockArticles} />);

			// The abstract HTML content should be rendered
			expect(screen.getByText("תקציר המאמר הראשון")).toBeTruthy();
		});

		it("links to author page", () => {
			render(<ArticlesSection articles={mockArticles} />);

			const links = screen.getAllByRole("link");
			expect(links).toHaveLength(2);
			expect(links[0]).toHaveAttribute("href", "/authors/1");
			expect(links[1]).toHaveAttribute("href", "/authors/2");
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
					authorName: "הרב משה",
					authorImageUrl: "https://test.s3.amazonaws.com/authors/high-res/1.jpg",
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
