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
		...rest
	}: {
		children: React.ReactNode;
		href: string;
		className?: string;
	}) => <a {...rest}>{children}</a>,
}));

jest.mock("@/lib/authors/url-utils", () => ({
	authorNameToSlug: (name: string) => encodeURIComponent(name),
}));

import { fireEvent, render, screen, within } from "@testing-library/react";
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

	it("demotes embedded content headings so the page keeps a single h1 (#2393)", () => {
		const { container } = render(
			<ArticleFullView
				article={{ ...baseArticle, content: "<h1>כותרת</h1><p>תוכן</p>" }}
				onBack={jest.fn()}
			/>,
		);
		expect(container.querySelector("h1")).toBeNull();
		expect(screen.getByRole("heading", { level: 2, name: "כותרת" })).toBeTruthy();
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

		fireEvent.click(screen.getByRole("button", { name: "חזרה למאמרים" }));

		expect(onBack).toHaveBeenCalledTimes(1);
	});

	it("renders author link pointing to /929/authors/{slug}", () => {
		render(<ArticleFullView article={baseArticle} onBack={jest.fn()} />);

		const authorLink = screen
			.getAllByRole("link")
			.find((el) => el.getAttribute("href")?.includes("/929/authors/"));
		expect(authorLink).toBeTruthy();
		expect(authorLink?.getAttribute("href")).toContain("/929/authors/");
	});

	it("renders share button with canonical href", () => {
		render(<ArticleFullView article={baseArticle} onBack={jest.fn()} />);

		const shareLink = screen.getByLabelText("שיתוף");
		expect(shareLink).toBeTruthy();
		expect(shareLink.getAttribute("href")).toBe("/929/1/1");
	});

	it("applies fullPage class when fullPage prop is true", () => {
		const { container } = render(
			<ArticleFullView article={baseArticle} onBack={jest.fn()} fullPage />,
		);

		// The root div should have the combined class
		const root = container.firstElementChild;
		expect(root?.className).toBeTruthy();
	});

	it("compacts header metadata and footer in book mode to enlarge the body (#2406)", () => {
		const { container } = render(
			<ArticleFullView article={baseArticle} onBack={jest.fn()} fullPage />,
		);

		const header = container.querySelector("header");
		expect(header?.className).toContain("articleHeaderInBook");

		const authorLink = screen.getByRole("link", { name: "הרב לדוגמא" });
		expect(authorLink.className).toContain("authorLinkInBook");
		expect(
			authorLink.querySelector("[class*='authorImageInBook']"),
		).not.toBeNull();

		expect(
			screen.getByRole("heading", { name: "מאמר לדוגמא" }).className,
		).toContain("articleTitleInBook");

		// The unified command row sits at the top; the old footer row is gone.
		const backRow = screen.getByRole("group", { name: "פעולות מאמר" });
		expect(backRow.className).toContain("articleActions");
		expect(container.querySelector("[class*='backToPerek']")).toBeNull();

		// The body keeps its inner-scroll wrapper in book mode.
		expect(
			container.querySelector("[class*='articleBodyWrapper']"),
		).not.toBeNull();
	});

	it("renders the article's own dedication lines under the header (#2731)", () => {
		render(
			<ArticleFullView
				article={baseArticle}
				dedicationLines={['מוקדש לראובן (לע"נ)']}
				onBack={jest.fn()}
				fullPage
			/>,
		);
		expect(screen.getByText('מוקדש לראובן (לע"נ)')).toBeTruthy();
	});

	it("renders nothing extra when no dedication lines apply", () => {
		const { container } = render(
			<ArticleFullView article={baseArticle} onBack={jest.fn()} />,
		);
		expect(container.querySelector("[class*='headerLine']")).toBeNull();
	});

	it("keeps the standalone article layout unmodified", () => {
		const { container } = render(
			<ArticleFullView article={baseArticle} onBack={jest.fn()} />,
		);

		const header = container.querySelector("header");
		expect(header?.className).not.toContain("InBook");
		const authorLink = screen.getByRole("link", { name: "הרב לדוגמא" });
		expect(authorLink.className).not.toContain("InBook");
		expect(container.querySelector("[class*='InBook']")).toBeNull();
	});

	describe("unified article command row (#2786)", () => {
		it("groups return, share and fullscreen commands in one labelled row", () => {
			const { container } = render(
				<ArticleFullView
					article={baseArticle}
					onBack={jest.fn()}
					fullPage
					onToggleFullscreen={jest.fn()}
				/>,
			);

			const bar = screen.getByRole("group", { name: "פעולות מאמר" });
			expect(bar).toHaveAttribute("data-flipbook-no-flip");
			expect(
				within(bar).getByRole("button", { name: "חזרה למאמרים" }),
			).toBeTruthy();
			const shareLink = within(bar).getByRole("link", { name: "שיתוף" });
			expect(shareLink).toHaveAttribute("href", "/929/1/1");
			expect(shareLink).toHaveTextContent("שתף");
			expect(
				within(bar).getByRole("button", { name: "מסך מלא" }),
			).toBeTruthy();
			// The command row is the first thing in the view; the old footer
			// back row is gone.
			expect(container.firstElementChild?.firstElementChild).toBe(bar);
			expect(
				container.querySelectorAll("[class*='backToPerek']"),
			).toHaveLength(0);
		});

		it("swaps the fullscreen command to an exit label without aria-pressed", () => {
			const onToggle = jest.fn();
			render(
				<ArticleFullView
					article={baseArticle}
					onBack={jest.fn()}
					fullscreen
					onToggleFullscreen={onToggle}
				/>,
			);

			const exit = screen.getByRole("button", { name: "יציאה ממסך מלא" });
			expect(exit.getAttribute("aria-pressed")).toBeNull();
			fireEvent.click(exit);
			expect(onToggle).toHaveBeenCalledTimes(1);
		});

		it("omits the fullscreen command when the caller has no fullscreen surface", () => {
			render(<ArticleFullView article={baseArticle} onBack={jest.fn()} />);

			expect(screen.queryByRole("button", { name: /מסך מלא/ })).toBeNull();
			// Share stays aligned with the return command regardless.
			const bar = screen.getByRole("group", { name: "פעולות מאמר" });
			expect(within(bar).getByRole("link", { name: "שיתוף" })).toBeTruthy();
			expect(
				within(bar).getByRole("button", { name: "חזרה למאמרים" }),
			).toBeTruthy();
		});
	});
});
