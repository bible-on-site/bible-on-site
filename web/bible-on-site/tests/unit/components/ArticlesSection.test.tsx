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
			content: "<p>תוכן מלא</p>",
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
			content: null,
			priority: 2,
			authorName: "הרב יעקב",
			authorImageUrl: "https://test.s3.amazonaws.com/authors/high-res/2.jpg",
		},
	];

	describe("when articles array is empty", () => {
		it("renders section with empty message", () => {
			render(<ArticlesSection articles={[]} />);
			expect(screen.getByText("אין מאמרים לפרק זה")).toBeTruthy();
		});
	});

	describe("when articles are provided", () => {
		it("renders the section header with icon and title", () => {
			const { container } = render(<ArticlesSection articles={mockArticles} />);

			const icon = container.querySelector('img[src*="/icons/book.svg"]');
			expect(icon?.getAttribute("aria-hidden")).toBe("true");
			expect(icon?.getAttribute("alt")).toBe("");
			expect(screen.getByText("מאמרים על הפרק")).toBeTruthy();
		});

		it("renders author names", () => {
			render(<ArticlesSection articles={mockArticles} />);

			expect(screen.getByText("הרב ישראל")).toBeTruthy();
			expect(screen.getByText("הרב יעקב")).toBeTruthy();
		});

		it("renders author images with correct alt text", () => {
			render(<ArticlesSection articles={mockArticles} />);

			const images = screen.getAllByRole("img");
			expect(images).toHaveLength(2);
			expect(images[0].getAttribute("alt")).toBe("הרב ישראל");
			expect(images[1].getAttribute("alt")).toBe("הרב יעקב");
		});

		it("renders article abstract when provided", () => {
			render(<ArticlesSection articles={mockArticles} />);

			// The abstract HTML content should be rendered
			expect(screen.getByText("תקציר המאמר הראשון")).toBeTruthy();
		});

		it("links to article page", () => {
			render(<ArticlesSection articles={mockArticles} />);

			const links = screen.getAllByRole("link");
			expect(links).toHaveLength(2);
			expect(links[0].getAttribute("href")).toBe("/929/1/1");
			expect(links[1].getAttribute("href")).toBe("/929/1/2");
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
					content: "<p>Full content</p>",
					priority: 1,
					authorName: "הרב משה",
					authorImageUrl:
						"https://test.s3.amazonaws.com/authors/high-res/1.jpg",
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

	describe("when onArticleClick is provided (callback mode)", () => {
		it("keeps crawlable article links while delegating clicks", () => {
			const handleClick = jest.fn();
			render(
				<ArticlesSection
					articles={mockArticles}
					onArticleClick={handleClick}
				/>,
			);

			const links = screen.getAllByRole("link");
			expect(links).toHaveLength(2);
			expect(links[0].getAttribute("href")).toBe("/929/1/1");
			expect(links[1].getAttribute("href")).toBe("/929/1/2");
		});

		it("calls onArticleClick when the link is clicked", async () => {
			const handleClick = jest.fn();
			render(
				<ArticlesSection
					articles={mockArticles}
					onArticleClick={handleClick}
				/>,
			);

			const links = screen.getAllByRole("link");
			links[0].click();

			expect(handleClick).toHaveBeenCalledTimes(1);
			expect(handleClick).toHaveBeenCalledWith(mockArticles[0]);
		});

		it("renders abstract in callback mode when present", () => {
			const handleClick = jest.fn();
			render(
				<ArticlesSection
					articles={mockArticles}
					onArticleClick={handleClick}
				/>,
			);

			// First article has abstract, second doesn't
			expect(screen.getByText("תקציר המאמר הראשון")).toBeTruthy();
		});
	});

	describe("when articles is null", () => {
		it("renders empty message", () => {
			render(<ArticlesSection articles={null} />);
			expect(screen.getByText("אין מאמרים לפרק זה")).toBeTruthy();
		});
	});

	describe("when loading is true", () => {
		it("sets aria-busy on section", () => {
			const { container } = render(
				<ArticlesSection articles={mockArticles} loading={true} />,
			);
			const section = container.querySelector("section");
			expect(section?.getAttribute("aria-busy")).toBe("true");
		});
	});
});
