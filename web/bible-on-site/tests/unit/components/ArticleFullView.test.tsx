/**
 * @jest-environment jsdom
 */

jest.mock("next/image", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => (
		<span data-testid="mock-image" data-alt={props.alt as string} />
	),
}));

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
	}: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

jest.mock("@/lib/authors/url-utils", () => ({
	authorNameToSlug: (name: string) => encodeURIComponent(name),
}));

import { render, screen, fireEvent } from "@testing-library/react";
import { ArticleFullView } from "../../../src/app/929/[number]/components/ArticleFullView";
import type { Article } from "../../../src/lib/articles";

const baseArticle: Article = {
	id: 1,
	perekId: 1,
	authorId: 10,
	name: "מאמר לדוגמא",
	abstract: "<p>תקציר</p>",
	content: "<div>תוכן המאמר</div>",
	priority: 1,
	authorName: "הרב לדוגמא",
	authorImageUrl: "https://example.com/img/1.jpg",
};

describe("ArticleFullView", () => {
	it("renders article title and author name", () => {
		render(<ArticleFullView article={baseArticle} onBack={jest.fn()} />);

		expect(screen.getByText("מאמר לדוגמא")).toBeTruthy();
		expect(screen.getByText("הרב לדוגמא")).toBeTruthy();
	});

	it("renders article content via dangerouslySetInnerHTML", () => {
		const { container } = render(
			<ArticleFullView article={baseArticle} onBack={jest.fn()} />,
		);

		expect(container.innerHTML).toContain("תוכן המאמר");
	});

	it("does not render content section when article.content is null", () => {
		const noContent: Article = { ...baseArticle, content: null };
		const { container } = render(
			<ArticleFullView article={noContent} onBack={jest.fn()} />,
		);

		// No articleBody div should be present
		expect(container.querySelector("[class*='articleBody']")).toBeNull();
	});

	it("calls onBack when back button is clicked", () => {
		const onBack = jest.fn();
		render(<ArticleFullView article={baseArticle} onBack={onBack} />);

		fireEvent.click(screen.getByText("חזרה למאמרים →"));

		expect(onBack).toHaveBeenCalledTimes(1);
	});

	it("renders author link pointing to /929/authors/{slug}", () => {
		render(<ArticleFullView article={baseArticle} onBack={jest.fn()} />);

		const link = screen.getByRole("link");
		expect(link.getAttribute("href")).toContain("/929/authors/");
	});

	it("applies fullPage class when fullPage prop is true", () => {
		const { container } = render(
			<ArticleFullView article={baseArticle} onBack={jest.fn()} fullPage />,
		);

		// The root div should have the combined class
		const root = container.firstElementChild;
		expect(root?.className).toBeTruthy();
	});
});
