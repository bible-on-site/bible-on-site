/**
 * @jest-environment jsdom
 *
 * Blank page of an alternative-division sefer book (issue #2191): the
 * facing page of a unit's text spread. It hosts the scope's
 * perushim/articles carousels (with book-scoped deep-link hrefs),
 * swaps to a bound perush or article view in place, publishes the open
 * perush so the facing text's pasuk numerals become navigation
 * targets, and reports the shown content's document title.
 */

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
		...rest
	}: {
		children: React.ReactNode;
		href: string;
	}) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

jest.mock("isomorphic-dompurify", () => ({
	__esModule: true,
	default: { sanitize: (html: string) => html },
}));

// The carousels and full views are mocked as prop-capturing stubs so
// this suite exercises UnitBlankPageContent's own wiring: slug
// resolution, selection effects, navigation callbacks and the open
// perush publication.
const perushimSectionProps: Record<string, unknown>[] = [];
jest.mock("@/app/929/[number]/components/PerushimSection", () => ({
	PerushimSection: (props: Record<string, unknown>) => {
		perushimSectionProps.push(props);
		return <div data-testid="perushim-section" />;
	},
}));

const articlesSectionProps: Record<string, unknown>[] = [];
jest.mock("@/app/929/[number]/components/ArticlesSection", () => ({
	ArticlesSection: (props: Record<string, unknown>) => {
		articlesSectionProps.push(props);
		return <div data-testid="articles-section" />;
	},
}));

jest.mock("@/app/929/[number]/components/ArticleFullView", () => ({
	ArticleFullView: (props: { onBack: () => void }) => (
		<div data-testid="article-full-view">
			<button type="button" onClick={props.onBack}>
				article back
			</button>
		</div>
	),
}));

const unitPerushFullViewProps: Record<string, unknown>[] = [];
jest.mock("@/app/components/reading/UnitPerushFullView", () => ({
	UnitPerushFullView: (props: Record<string, unknown>) => {
		unitPerushFullViewProps.push(props);
		return (
			<div data-testid="unit-perush-full-view">
				<button type="button" onClick={props.onBack as () => void}>
					perush back
				</button>
			</div>
		);
	},
}));

jest.mock("@/app/929/[number]/components/sefer-document-title", () => ({
	articleDocumentTitle: jest.fn(
		(article: { name: string }) => `ARTICLE_TITLE:${article.name}`,
	),
}));

jest.mock("@/app/929/[number]/actions", () => ({
	getArticleForBook: jest.fn(),
}));

jest.mock("@/app/components/reading/unit-book-actions", () => ({
	getUnitBookPerushNotes: jest.fn(),
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
import { getArticleForBook } from "@/app/929/[number]/actions";
import { UnitBlankPageContent } from "@/app/components/reading/UnitBlankPageContent";
import { getUnitBookPerushNotes } from "@/app/components/reading/unit-book-actions";
import { getUnitOpenPerush } from "@/app/components/reading/unit-book-navigation";

const mockGetArticleForBook = getArticleForBook as jest.MockedFunction<
	typeof getArticleForBook
>;
const mockGetUnitBookPerushNotes =
	getUnitBookPerushNotes as jest.MockedFunction<typeof getUnitBookPerushNotes>;

const PERUSHIM = [
	{ id: 38, name: 'רש"י', parshanName: 'רש"י', noteCount: 5, perekId: 1 },
	{ id: 40, name: 'רמב"ן', parshanName: 'רמב"ן', noteCount: 3, perekId: 1 },
];

const ARTICLES = [
	{
		id: 7,
		name: "מאמר ראשון",
		abstract: "<p>א</p>",
		perekId: 1,
		authorId: 1,
		priority: 1,
		authorName: "מחבר",
		authorImageUrl: "",
	},
	{
		id: 9,
		name: "מאמר שני",
		abstract: "<p>ב</p>",
		perekId: 1,
		authorId: 1,
		priority: 2,
		authorName: "מחבר",
		authorImageUrl: "",
	},
];

const NOTES = [
	{ perekId: 1, pasuk: 2, noteIdx: 0, noteContent: "<p>נ1</p>" },
	{ perekId: 1, pasuk: 4, noteIdx: 0, noteContent: "<p>נ2</p>" },
];

function renderPage(extra: Record<string, unknown> = {}) {
	return render(
		<UnitBlankPageContent
			division="masora"
			unitId={8}
			scope="torah"
			unitPath="/מסורה/8"
			articles={ARTICLES}
			perushim={PERUSHIM}
			perekSources={{ 1: "בראשית א" }}
			hebrewDateStr="כג סיון"
			fallbackPerekId={1}
			titles={{
				perushim: "פרשנים על הפרשה",
				articles: "מאמרים על הפרשה",
				perushEmpty: "אין פרשנות לפרשה זו",
				articleEmpty: "אין מאמרים לפרשה זו",
			}}
			{...extra}
		/>,
	);
}

/** Latest captured props; throws when the mock rendered nothing. */
function last<T>(items: T[]): T {
	const item = items.at(-1);
	if (item === undefined) throw new Error("expected a captured render");
	return item;
}

function clickPerush(name = 'רש"י') {
	const props = last(perushimSectionProps);
	act(() => {
		(props.onPerushClick as (p: { name: string }) => void)({ name });
	});
}

function clickArticle(id = 7) {
	const props = last(articlesSectionProps);
	act(() => {
		(props.onArticleClick as (a: { id: number }) => void)({ id });
	});
}

describe("UnitBlankPageContent", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		perushimSectionProps.length = 0;
		articlesSectionProps.length = 0;
		unitPerushFullViewProps.length = 0;
		mockGetArticleForBook.mockResolvedValue(null);
		mockGetUnitBookPerushNotes.mockResolvedValue(NOTES);
		jest.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("renders the carousels with book-scoped perush/article hrefs", () => {
		renderPage({ scrollStorageKey: "masora-8-torah" });
		const perushProps = last(perushimSectionProps);
		expect(perushProps.title).toBe("פרשנים על הפרשה");
		expect(perushProps.emptyMessage).toBe("אין פרשנות לפרשה זו");
		expect(perushProps.scrollStorageKey).toBe("perushim-masora-8-torah");
		expect(
			(perushProps.hrefForPerush as (p: { name: string }) => string)({
				name: 'רש"י',
			}),
		).toBe(`/מסורה/8?book=&perush=${encodeURIComponent('רש"י')}`);

		const articleProps = last(articlesSectionProps);
		expect(articleProps.title).toBe("מאמרים על הפרשה");
		expect(articleProps.scrollStorageKey).toBe("articles-masora-8-torah");
		expect(
			(articleProps.hrefForArticle as (a: { id: number }) => string)({
				id: 7,
			}),
		).toBe("/מסורה/8?book=&article=7");
	});

	it("hides the perushim carousel when the scope has none", () => {
		renderPage({ perushim: [] });
		expect(screen.queryByTestId("perushim-section")).toBeNull();
		expect(screen.getByTestId("articles-section")).toBeInTheDocument();
	});

	it("names the haftara spread in haftara-scope hrefs", () => {
		renderPage({ scope: "haftara" });
		expect(
			(
				last(perushimSectionProps).hrefForPerush as (p: {
					name: string;
				}) => string
			)({ name: "x" }),
		).toBe("/מסורה/8?book=&haftara=&haftaraPerush=x");
	});

	it("opens a perush in place, publishes its pesukim, and reports its title", async () => {
		const onNavigate = jest.fn();
		const onContentTitle = jest.fn();
		renderPage({
			onNavigate,
			onContentTitle,
			perushTitle: (n: string) => `${n} על פרשה`,
		});

		clickPerush();
		expect(onNavigate).toHaveBeenCalledWith("perush", 'רש"י');
		await screen.findByTestId("unit-perush-full-view");

		expect(mockGetUnitBookPerushNotes).toHaveBeenCalledWith(
			"masora",
			8,
			"torah",
			38,
		);
		const viewProps = last(unitPerushFullViewProps);
		expect(viewProps.name).toBe('רש"י');
		expect(viewProps.notes).toEqual(NOTES);
		expect(viewProps.bookKey).toBe("8:torah");
		expect(viewProps.sharePath).toBe(
			`/מסורה/8?book=&perush=${encodeURIComponent('רש"י')}`,
		);

		// The facing text's numerals become navigation targets.
		expect(getUnitOpenPerush("8:torah")).toEqual({
			name: 'רש"י',
			pesukim: new Set(["1-2", "1-4"]),
		});
		expect(onContentTitle).toHaveBeenLastCalledWith('רש"י על פרשה');

		fireEvent.click(screen.getByText("perush back"));
		await screen.findByTestId("perushim-section");
		expect(onNavigate).toHaveBeenLastCalledWith(undefined, undefined);
		expect(getUnitOpenPerush("8:torah")).toBeNull();
		expect(onContentTitle).toHaveBeenLastCalledWith(null);
	});

	it("opens an article in place and reports its document title", async () => {
		const article = { id: 7, name: "מאמר ראשון", content: "<p>תוכן</p>" };
		mockGetArticleForBook.mockResolvedValue(article as never);
		const onNavigate = jest.fn();
		const onContentTitle = jest.fn();
		renderPage({ onNavigate, onContentTitle });

		clickArticle(7);
		expect(onNavigate).toHaveBeenCalledWith("article", "7");
		await screen.findByTestId("article-full-view");
		expect(mockGetArticleForBook).toHaveBeenCalledWith(7);
		expect(onContentTitle).toHaveBeenLastCalledWith("ARTICLE_TITLE:מאמר ראשון");

		fireEvent.click(screen.getByText("article back"));
		await screen.findByTestId("articles-section");
		expect(onNavigate).toHaveBeenLastCalledWith(undefined, undefined);
	});

	it("restores a perush from its initial slug", async () => {
		renderPage({ initialSlug: 'רש"י' });
		await screen.findByTestId("unit-perush-full-view");
		expect(mockGetUnitBookPerushNotes).toHaveBeenCalledWith(
			"masora",
			8,
			"torah",
			38,
		);
	});

	it("restores an article from its initial slug", async () => {
		mockGetArticleForBook.mockResolvedValue({
			id: 9,
			name: "מאמר שני",
		} as never);
		renderPage({ initialSlug: "9" });
		await screen.findByTestId("article-full-view");
		expect(mockGetArticleForBook).toHaveBeenCalledWith(9);
	});

	it("responds to a new slug without remounting", async () => {
		mockGetArticleForBook.mockResolvedValue({
			id: 7,
			name: "מאמר ראשון",
		} as never);
		const view = renderPage({ initialSlug: "7" });
		await screen.findByTestId("article-full-view");

		view.rerender(
			<UnitBlankPageContent
				division="masora"
				unitId={8}
				scope="torah"
				unitPath="/מסורה/8"
				articles={ARTICLES}
				perushim={PERUSHIM}
				perekSources={{ 1: "בראשית א" }}
				hebrewDateStr="כג סיון"
				fallbackPerekId={1}
				initialSlug={'רש"י'}
				titles={{
					perushim: "פרשנים על הפרשה",
					articles: "מאמרים על הפרשה",
					perushEmpty: "אין פרשנות לפרשה זו",
					articleEmpty: "אין מאמרים לפרשה זו",
				}}
			/>,
		);
		await screen.findByTestId("unit-perush-full-view");
		expect(screen.queryByTestId("article-full-view")).toBeNull();
	});

	it("returns to the carousels when an article fails to load", async () => {
		mockGetArticleForBook.mockRejectedValue(new Error("gone"));
		renderPage({ initialSlug: "7" });
		await waitFor(() =>
			expect(screen.getByTestId("articles-section")).toBeInTheDocument(),
		);
		expect(console.error).toHaveBeenCalled();
		expect(screen.queryByTestId("article-full-view")).toBeNull();
	});

	it("returns to the carousels when perush notes fail to load", async () => {
		mockGetUnitBookPerushNotes.mockRejectedValue(new Error("gone"));
		renderPage({ initialSlug: 'רש"י' });
		await waitFor(() =>
			expect(screen.getByTestId("perushim-section")).toBeInTheDocument(),
		);
		expect(console.error).toHaveBeenCalled();
		expect(screen.queryByTestId("unit-perush-full-view")).toBeNull();
	});

	it("clears the selection when a fetched article resolves to null", async () => {
		mockGetArticleForBook.mockResolvedValue(null);
		renderPage({ initialSlug: "7" });
		await waitFor(() =>
			expect(screen.getByTestId("articles-section")).toBeInTheDocument(),
		);
		expect(screen.queryByTestId("article-full-view")).toBeNull();
	});

	it("tolerates null summary batches while a scope loads", () => {
		renderPage({ articles: null, perushim: null });
		expect(screen.getByTestId("articles-section")).toBeInTheDocument();
		expect(last(articlesSectionProps).articles).toEqual([]);
		expect(screen.queryByTestId("perushim-section")).toBeNull();
	});

	it.each([
		["article", "resolve"],
		["article", "reject"],
		["commentary", "resolve"],
		["commentary", "reject"],
	] as const)(
		"keeps the current article when an earlier %s request later %s",
		async (kind, outcome) => {
			let resolve!: (value: never) => void;
			let reject!: (reason: Error) => void;
			const pending = new Promise<never>((onResolve, onReject) => {
				resolve = onResolve;
				reject = onReject;
			});
			const currentArticle = { id: 9, name: "Current article" };
			mockGetArticleForBook.mockResolvedValue(currentArticle as never);
			if (kind === "article") {
				mockGetArticleForBook.mockReturnValueOnce(pending);
			} else {
				mockGetUnitBookPerushNotes.mockReturnValueOnce(pending);
			}
			const onContentTitle = jest.fn();
			renderPage({
				initialSlug: kind === "article" ? "7" : PERUSHIM[0].name,
				onContentTitle,
			});
			clickArticle(9);
			await screen.findByTestId("article-full-view");
			await waitFor(() =>
				expect(onContentTitle).toHaveBeenLastCalledWith(
					"ARTICLE_TITLE:Current article",
				),
			);
			await act(async () => {
				if (outcome === "reject") {
					reject(new Error("Previous request failed after navigation"));
				} else {
					resolve(
						(kind === "article"
							? { id: 7, name: "Old article" }
							: NOTES) as never,
					);
				}
				await pending.catch(() => {});
			});
			expect(screen.getByTestId("article-full-view")).toBeInTheDocument();
			expect(screen.queryByTestId("unit-perush-full-view")).toBeNull();
			expect(onContentTitle).toHaveBeenLastCalledWith(
				"ARTICLE_TITLE:Current article",
			);
			expect(getUnitOpenPerush("8:torah")).toBeNull();
		},
	);

	it("ignores a slug that matches neither carousel", async () => {
		renderPage({ initialSlug: "does-not-exist" });
		await act(async () => {});
		expect(mockGetArticleForBook).not.toHaveBeenCalled();
		expect(mockGetUnitBookPerushNotes).not.toHaveBeenCalled();
		expect(screen.getByTestId("articles-section")).toBeInTheDocument();
	});
});
