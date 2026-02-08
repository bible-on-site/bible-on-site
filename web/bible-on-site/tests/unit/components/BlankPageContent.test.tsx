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

// Mock the server action
jest.mock(
	"../../../../src/app/929/[number]/actions",
	() => ({
		getArticleForBook: jest.fn(),
	}),
	{ virtual: true },
);

// Also mock with the @/ alias path
jest.mock("../../../src/app/929/[number]/actions", () => ({
	getArticleForBook: jest.fn(),
}));

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { BlankPageContent } from "../../../src/app/929/[number]/components/BlankPageContent";
import { getArticleForBook } from "../../../src/app/929/[number]/actions";
import type { Article } from "../../../src/lib/articles";

const mockGetArticleForBook = getArticleForBook as jest.MockedFunction<
	typeof getArticleForBook
>;

const mockArticles: Article[] = [
	{
		id: 1,
		perekId: 1,
		authorId: 10,
		name: "מאמר ראשון",
		abstract: "<p>תקציר</p>",
		content: "<p>תוכן</p>",
		priority: 1,
		authorName: "הרב ישראל",
		authorImageUrl: "https://example.com/1.jpg",
	},
];

describe("BlankPageContent", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("renders date string", () => {
		render(
			<BlankPageContent articles={mockArticles} hebrewDateStr="י׳ בשבט" />,
		);

		expect(screen.getByText("י׳ בשבט")).toBeTruthy();
	});

	it("renders ArticlesSection when no article is selected", () => {
		render(
			<BlankPageContent articles={mockArticles} hebrewDateStr="י׳ בשבט" />,
		);

		// ArticlesSection renders author names in carousel buttons
		expect(screen.getByText("הרב ישראל")).toBeTruthy();
	});

	it("shows full article after clicking on a carousel item", async () => {
		const fullArticle: Article = {
			...mockArticles[0],
			content: "<div>תוכן מלא של המאמר</div>",
		};
		mockGetArticleForBook.mockResolvedValue(fullArticle);

		render(
			<BlankPageContent articles={mockArticles} hebrewDateStr="י׳ בשבט" />,
		);

		// Click the carousel button (has the author name)
		const articleButton = screen.getByRole("button");
		await act(async () => {
			fireEvent.click(articleButton);
		});

		await waitFor(() => {
			// ArticleFullView should now be rendered with back button
			expect(screen.getByText("חזרה למאמרים →")).toBeTruthy();
		});
	});

	it("returns to carousel after clicking back", async () => {
		const fullArticle: Article = {
			...mockArticles[0],
			content: "<div>full content</div>",
		};
		mockGetArticleForBook.mockResolvedValue(fullArticle);

		render(
			<BlankPageContent articles={mockArticles} hebrewDateStr="י׳ בשבט" />,
		);

		// Click carousel item to open full view
		await act(async () => {
			fireEvent.click(screen.getByRole("button"));
		});

		await waitFor(() => {
			expect(screen.getByText("חזרה למאמרים →")).toBeTruthy();
		});

		// Click back
		await act(async () => {
			fireEvent.click(screen.getByText("חזרה למאמרים →"));
		});

		// Should return to articles list with author name visible
		await waitFor(() => {
			expect(screen.getByText("הרב ישראל")).toBeTruthy();
		});
	});

	it("handles null from getArticleForBook gracefully", async () => {
		mockGetArticleForBook.mockResolvedValue(null);

		render(
			<BlankPageContent articles={mockArticles} hebrewDateStr="י׳ בשבט" />,
		);

		await act(async () => {
			fireEvent.click(screen.getByRole("button"));
		});

		// Should still show articles carousel (no full view since null returned)
		await waitFor(() => {
			expect(screen.getByText("הרב ישראל")).toBeTruthy();
		});
	});
});
