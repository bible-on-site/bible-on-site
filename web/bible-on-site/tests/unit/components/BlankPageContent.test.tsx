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
	{ id: 1, name: 'רש"י', parshanName: 'רש"י', noteCount: 10 },
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

	it("waits for summaries and responds to new article and perush routes without pushing history", async () => {
		mockGetArticleForBook.mockResolvedValue(mockArticles[0]);
		mockGetPerushNotesForPage.mockResolvedValue([]);
		const push = jest.spyOn(History.prototype, "pushState");
		const props = { perekId: 1, hebrewDateStr: "date" };
		const { rerender } = render(<BlankPageContent {...props} articles={[]} initialSlug="1" />);
		expect(mockGetArticleForBook).not.toHaveBeenCalled();
		rerender(<BlankPageContent {...props} articles={mockArticles} initialSlug="1" />);
		await screen.findByText("חזרה למאמרים →");
		rerender(<BlankPageContent {...props} perushim={mockPerushim} initialSlug={'רש"י'} />);
		await screen.findByText("→ חזרה לפרשנים");
		rerender(<BlankPageContent {...props} perushim={mockPerushim} />);
		await screen.findByText("פרשנים על הפרק");
		expect(screen.queryByText("→ חזרה לפרשנים")).toBeNull();
		expect(push).not.toHaveBeenCalled();
		push.mockRestore();
	});

	it("does not replace a newer perush with a late article response", async () => {
		let resolveArticle: (article: Article) => void = () => {};
		mockGetArticleForBook.mockReturnValue(new Promise((resolve) => { resolveArticle = resolve; }));
		mockGetPerushNotesForPage.mockResolvedValue([]);
		const props = { perekId: 1, articles: mockArticles, perushim: mockPerushim, hebrewDateStr: "date" };
		const { rerender } = render(<BlankPageContent {...props} initialSlug="1" />);
		rerender(<BlankPageContent {...props} initialSlug={'רש"י'} />);
		await screen.findByText("→ חזרה לפרשנים");
		await act(async () => resolveArticle(mockArticles[0]));
		expect(screen.queryByText("חזרה למאמרים →")).toBeNull();
		expect(screen.getByText("→ חזרה לפרשנים")).toBeVisible();
	});

	it("ignores a late perush response after returning to the carousel", async () => {
		let resolveNotes: (notes: Awaited<ReturnType<typeof getPerushNotesForPage>>) => void = () => {};
		mockGetPerushNotesForPage.mockReturnValue(new Promise((resolve) => { resolveNotes = resolve; }));
		const props = { perekId: 1, perushim: mockPerushim, hebrewDateStr: "date" };
		const { rerender } = render(<BlankPageContent {...props} initialSlug={'רש"י'} />);
		rerender(<BlankPageContent {...props} />);
		await act(async () => resolveNotes([]));
		expect(screen.queryByText("→ חזרה לפרשנים")).toBeNull();
		expect(screen.getByText("פרשנים על הפרק")).toBeVisible();
	});

	it("delegates clicks to book navigation and logs article failures", async () => {
		const onNavigate = jest.fn();
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		mockGetArticleForBook.mockRejectedValue(new Error("article unavailable"));
		try {
			render(<BlankPageContent perekId={1} articles={mockArticles} hebrewDateStr="date" onNavigate={onNavigate} />);
			await act(async () => fireEvent.click(screen.getByRole("button")));
			expect(onNavigate).toHaveBeenCalledWith("1");
			expect(error).toHaveBeenCalledWith("Failed to load book article", expect.objectContaining({ perekId: 1, articleId: 1 }));
			expect(screen.queryByText("חזרה למאמרים →")).toBeNull();
		} finally {
			error.mockRestore();
		}
	});

	it.each(["article", "perush"])("allows retrying the same %s after a request failure", async (kind) => {
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		mockGetArticleForBook.mockResolvedValue(mockArticles[0]);
		mockGetPerushNotesForPage.mockResolvedValue([]);
		const request = kind === "article" ? mockGetArticleForBook : mockGetPerushNotesForPage;
		request.mockRejectedValueOnce(new Error("temporary failure"));
		try {
			render(<BlankPageContent perekId={1} articles={mockArticles} perushim={mockPerushim} hebrewDateStr="date" />);
			const name = kind === "article" ? /הרב ישראל/ : /רש"י/;
			await act(async () => fireEvent.click(screen.getByRole("button", { name })));
			expect(request).toHaveBeenCalledTimes(1);
			await act(async () => fireEvent.click(screen.getByRole("button", { name })));
			expect(request).toHaveBeenCalledTimes(2);
			expect(screen.getByText(kind === "article" ? "חזרה למאמרים →" : "→ חזרה לפרשנים")).toBeVisible();
		} finally {
			error.mockRestore();
		}
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

	it("returns an expanded article to its chapter's book route", async () => {
		mockGetArticleForBook.mockResolvedValue(mockArticles[0]);
		const push = jest.spyOn(History.prototype, "pushState");
		try {
			render(
				<BlankPageContent
					articles={mockArticles}
					perekId={615}
					hebrewDateStr="י׳ בשבט"
					initialSlug="1"
				/>,
			);
			await screen.findByText("חזרה למאמרים →");
			push.mockClear();
			fireEvent.click(screen.getByText("חזרה למאמרים →"));
			expect(push).toHaveBeenCalledWith(expect.objectContaining({ route: "/929/615?book" }), "", "/929/615?book");
			expect(screen.getByText("הרב ישראל")).toBeVisible();
		} finally {
			push.mockRestore();
		}
	});

	it("pushes correct history URL when clicking article (includes perekId)", async () => {
		const fullArticle: Article = {
			...mockArticles[0],
			content: "<div>content</div>",
		};
		mockGetArticleForBook.mockResolvedValue(fullArticle);
		const pushSpy = jest.spyOn(History.prototype, "pushState");

		render(
			<BlankPageContent
				articles={mockArticles}
				perekId={615}
				hebrewDateStr="י׳ בשבט"
			/>,
		);

		await act(async () => {
			fireEvent.click(screen.getByRole("button"));
		});

		await waitFor(() => {
			expect(pushSpy).toHaveBeenCalledWith(
				expect.objectContaining({ route: "/929/615/1?book" }),
				"",
				"/929/615/1?book",
			);
		});

		pushSpy.mockRestore();
	});

	it("pushes correct history URL when clicking perush (includes perekId)", async () => {
		mockGetPerushNotesForPage.mockResolvedValue([
			{ pasuk: 1, noteIdx: 0, noteContent: "<p>content</p>" },
		]);
		const pushSpy = jest.spyOn(History.prototype, "pushState");

		render(
			<BlankPageContent
				articles={[]}
				perushim={mockPerushim}
				perekId={615}
				hebrewDateStr="י׳ בשבט"
			/>,
		);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /רש"י/ }));
		});

		await waitFor(() => {
			expect(pushSpy).toHaveBeenCalledWith(
				expect.objectContaining({ route: "/929/615/%D7%A8%D7%A9%22%D7%99?book" }),
				"",
				"/929/615/%D7%A8%D7%A9%22%D7%99?book",
			);
		});

		pushSpy.mockRestore();
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

		const perushButton = screen.getByRole("button", { name: /רש"י/ });
		await act(async () => {
			fireEvent.click(perushButton);
		});

		await waitFor(() => {
			expect(screen.getByText("→ חזרה לפרשנים")).toBeTruthy();
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
			fireEvent.click(screen.getByRole("button", { name: /רש"י/ }));
		});

		await waitFor(() => {
			expect(screen.getByText("→ חזרה לפרשנים")).toBeTruthy();
		});

		// Click back
		await act(async () => {
			fireEvent.click(screen.getByText(/חזרה לפרשנים/));
		});

		await waitFor(() => {
			expect(screen.getByText("פרשנים על הפרק")).toBeTruthy();
		});
	});

	it("logs a perush failure and keeps the carousel available", async () => {
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
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
			fireEvent.click(screen.getByRole("button", { name: /רש"י/ }));
		});

		expect(error).toHaveBeenCalledWith("Failed to load book commentary", expect.objectContaining({perekId: 1, perushId: 1}));
		error.mockRestore();
		// The failed request leaves the carousel visible.
		await waitFor(() => {
			expect(screen.getByText("פרשנים על הפרק")).toBeTruthy();
		});
	});

	describe("initialSlug", () => {
		it("finds a deep-linked commentary after other commentaries and returns without a chapter history entry", async () => {
			mockGetPerushNotesForPage.mockResolvedValue([]);
			const historySpy = jest.spyOn(History.prototype, "pushState");
			try {
				render(
					<BlankPageContent
						articles={[]}
						perushim={[
							...mockPerushim,
							{ id: 2, name: "רמב״ן", parshanName: "רמב״ן", noteCount: 1 },
						]}
						hebrewDateStr="י׳ בשבט"
						initialSlug="רמב״ן"
					/>,
				);
				await screen.findByText("→ חזרה לפרשנים");
				expect(mockGetPerushNotesForPage).toHaveBeenCalledWith(2, 0);
				historySpy.mockClear();
				fireEvent.click(screen.getByText("→ חזרה לפרשנים"));
				expect(historySpy).not.toHaveBeenCalled();
				expect(screen.getByText("פרשנים על הפרק")).toBeVisible();
			} finally {
				historySpy.mockRestore();
			}
		});
		it("leaves an unknown commentary slug at the carousel without requesting notes", () => {
			render(
				<BlankPageContent
					articles={mockArticles}
					perushim={mockPerushim}
					perekId={1}
					hebrewDateStr="י׳ בשבט"
					initialSlug="unknown-commentary"
				/>,
			);
			expect(mockGetPerushNotesForPage).not.toHaveBeenCalled();
			expect(screen.getByText("פרשנים על הפרק")).toBeVisible();
		});
		it("auto-expands article when initialSlug is numeric (article ID)", async () => {
			const fullArticle: Article = {
				...mockArticles[0],
				content: "<div>תוכן אוטומטי</div>",
			};
			mockGetArticleForBook.mockResolvedValue(fullArticle);

			await act(async () => {
				render(
					<BlankPageContent
						articles={mockArticles}
						hebrewDateStr="י׳ בשבט"
						initialSlug="1"
					/>,
				);
			});

			await waitFor(() => {
				expect(mockGetArticleForBook).toHaveBeenCalledWith(1);
				expect(screen.getByText("חזרה למאמרים →")).toBeTruthy();
			});
		});

		it("auto-expands perush when initialSlug is a perush name", async () => {
			mockGetPerushNotesForPage.mockResolvedValue([
				{ pasuk: 1, noteIdx: 0, noteContent: "<p>פירוש אוטומטי</p>" },
			]);

			await act(async () => {
				render(
					<BlankPageContent
						articles={[]}
						perushim={mockPerushim}
						perekId={1}
						hebrewDateStr="י׳ בשבט"
						initialSlug={'רש"י'}
					/>,
				);
			});

			await waitFor(() => {
				expect(mockGetPerushNotesForPage).toHaveBeenCalledWith(1, 1);
				expect(screen.getByText("→ חזרה לפרשנים")).toBeTruthy();
			});
		});

		it("does nothing when initialSlug matches no article or perush", async () => {
			render(
				<BlankPageContent
					articles={mockArticles}
					perushim={mockPerushim}
					perekId={1}
					hebrewDateStr="י׳ בשבט"
					initialSlug="999"
				/>,
			);

			// Should still show carousels (no auto-expand)
			expect(screen.getByText("הרב ישראל")).toBeTruthy();
			expect(mockGetArticleForBook).not.toHaveBeenCalled();
		});

		it("does not re-trigger on re-render", async () => {
			const fullArticle: Article = {
				...mockArticles[0],
				content: "<div>content</div>",
			};
			mockGetArticleForBook.mockResolvedValue(fullArticle);

			const { rerender } = render(
				<BlankPageContent
					articles={mockArticles}
					hebrewDateStr="י׳ בשבט"
					initialSlug="1"
				/>,
			);

			await waitFor(() => {
				expect(mockGetArticleForBook).toHaveBeenCalledTimes(1);
			});

			// Re-render with same props
			await act(async () => {
				rerender(
					<BlankPageContent
						articles={mockArticles}
						hebrewDateStr="י׳ בשבט"
						initialSlug="1"
					/>,
				);
			});

			// Should not have been called again
			expect(mockGetArticleForBook).toHaveBeenCalledTimes(1);
		});
	});
});
