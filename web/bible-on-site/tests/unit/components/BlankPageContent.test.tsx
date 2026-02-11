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
	}: {
		children: React.ReactNode;
		href: string;
	}) => <a href={href}>{children}</a>,
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
	getPerushNotesForPage: jest.fn(),
}));

jest.mock("isomorphic-dompurify", () => ({
	__esModule: true,
	default: { sanitize: (html: string) => html },
}));

jest.mock(
	"@/app/929/[number]/components/perushim-section.module.css",
	() => ({}),
);
jest.mock("@/app/929/[number]/components/sefer.module.css", () => ({}));

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {
	getArticleForBook,
	getPerushNotesForPage,
} from "../../../src/app/929/[number]/actions";
import { BlankPageContent } from "../../../src/app/929/[number]/components/BlankPageContent";
import type { Article } from "../../../src/lib/articles";

const mockGetArticleForBook = getArticleForBook as jest.MockedFunction<
	typeof getArticleForBook
>;
const mockGetPerushNotesForPage = getPerushNotesForPage as jest.MockedFunction<
	typeof getPerushNotesForPage
>;

const mockPerushim = [
	{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 10 },
];

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

	it("shows PerushFullView after clicking a perush carousel item", async () => {
		mockGetPerushNotesForPage.mockResolvedValue([
			{ pasuk: 1, noteIdx: 0, noteContent: "<p>פירוש ראשון</p>" },
		]);

		render(
			<BlankPageContent
				articles={[]}
				perushim={mockPerushim}
				perekId={1}
				hebrewDateStr="י׳ בשבט"
			/>,
		);

		const perushButton = screen.getByRole("button", { name: /רש״י/ });
		await act(async () => {
			fireEvent.click(perushButton);
		});

		await waitFor(() => {
			expect(screen.getByText("חזרה לפרשנים ←")).toBeTruthy();
		});
	});

	it("returns to carousel after clicking perush back button", async () => {
		mockGetPerushNotesForPage.mockResolvedValue([
			{ pasuk: 1, noteIdx: 0, noteContent: "<p>content</p>" },
		]);

		render(
			<BlankPageContent
				articles={[]}
				perushim={mockPerushim}
				perekId={1}
				hebrewDateStr="י׳ בשבט"
			/>,
		);

		// Click perush to open full view
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /רש״י/ }));
		});

		await waitFor(() => {
			expect(screen.getByText("חזרה לפרשנים ←")).toBeTruthy();
		});

		// Click back
		await act(async () => {
			fireEvent.click(screen.getByText(/חזרה לפרשנים/));
		});

		await waitFor(() => {
			expect(screen.getByText("פרשנים על הפרק")).toBeTruthy();
		});
	});

	it("handles perush click error gracefully", async () => {
		mockGetPerushNotesForPage.mockRejectedValue(new Error("fail"));

		render(
			<BlankPageContent
				articles={[]}
				perushim={mockPerushim}
				perekId={1}
				hebrewDateStr="י׳ בשבט"
			/>,
		);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /רש״י/ }));
		});

		// Should still show carousel (selectedPerush set to null on error)
		await waitFor(() => {
			expect(screen.getByText("פרשנים על הפרק")).toBeTruthy();
		});
	});
});
