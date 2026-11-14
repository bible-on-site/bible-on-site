/**
 * Unit tests for the daily Hebrew-date article override UI path (#3098):
 * the swap hook plus the DailyArticlesSection wrapper used by the flat and
 * slug pages, and the panel selection Sefer relies on.
 */

import { render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ArticleSummary } from "../../../src/lib/articles";

jest.mock("../../../src/app/929/[number]/components/ArticlesSection", () => ({
	ArticlesSection: (props: { articles?: unknown[] | null }) => (
		<div data-testid="articles-section">
			{(props.articles ?? []).map((a) => (
				<span key={(a as { id: number }).id}>
					{(a as { name: string }).name}
				</span>
			))}
		</div>
	),
}));

const mockGetPerekIdByDate = jest.fn((..._args: unknown[]) => 55);
const mockConstructHDate = jest.fn((..._args: unknown[]) => ({
	getUniformMonth: () => 11,
	day: 9,
}));
const mockGetDailyArticleOverride = jest.fn();

jest.mock("../../../src/data/perek-calendar", () => ({
	getPerekIdByDate: (...args: unknown[]) =>
		mockGetPerekIdByDate(...(args as [Date])),
}));

jest.mock("../../../src/util/hebdates-util", () => ({
	constructTsetAwareHDate: (...args: unknown[]) =>
		mockConstructHDate(...(args as [Date])),
}));

jest.mock("../../../src/app/929/[number]/actions", () => ({
	getDailyArticleOverride: (...args: unknown[]) =>
		mockGetDailyArticleOverride(...(args as [number, number])),
}));

import { DailyArticlesSection } from "../../../src/app/929/[number]/components/DailyArticlesSection";
import { useDailyArticleOverride } from "../../../src/app/929/[number]/components/use-daily-article-override";

const chapterArticles: ArticleSummary[] = [
	{
		id: 1,
		perekId: 55,
		authorId: 1,
		abstract: null,
		name: "מאמר רגיל",
		priority: 1,
		authorName: "מחבר",
		authorImageUrl: "",
	},
];

const assignedArticle: ArticleSummary = {
	id: 2199,
	perekId: 535,
	authorId: 7,
	abstract: "<p>תקציר</p>",
	name: "לימוד לתשעה באב",
	priority: 1,
	authorName: "הרב לדוגמא",
	authorImageUrl: "",
};

describe("useDailyArticleOverride", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});
	afterEach(() => {
		(console.warn as jest.Mock).mockRestore();
	});

	it("resolves today's daily perek plus the assigned article", async () => {
		mockGetPerekIdByDate.mockReturnValue(55);
		mockConstructHDate.mockReturnValue({ getUniformMonth: () => 11, day: 9 });
		mockGetDailyArticleOverride.mockResolvedValue(assignedArticle);

		const { result } = renderHook(() => useDailyArticleOverride());

		await waitFor(() =>
			expect(result.current).toEqual({
				perekId: 55,
				articles: [assignedArticle],
			}),
		);
		// The live lookup goes out with the tzeit-aware uniform month/day.
		expect(mockGetDailyArticleOverride).toHaveBeenCalledWith(11, 9);
	});

	it("stays null when today's date has no assignment", async () => {
		mockGetDailyArticleOverride.mockResolvedValue(null);

		const { result } = renderHook(() => useDailyArticleOverride());

		await waitFor(() => expect(mockGetDailyArticleOverride).toHaveBeenCalled());
		expect(result.current).toBeNull();
	});

	it("keeps the static list when the lookup fails", async () => {
		mockGetDailyArticleOverride.mockRejectedValue(new Error("offline"));

		const { result } = renderHook(() => useDailyArticleOverride());

		await waitFor(() => expect(mockGetDailyArticleOverride).toHaveBeenCalled());
		await waitFor(() => expect(result.current).toBeNull());
		expect(console.warn).toHaveBeenCalled();
	});
});

describe("DailyArticlesSection", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
		mockGetPerekIdByDate.mockReturnValue(55);
		mockConstructHDate.mockReturnValue({ getUniformMonth: () => 11, day: 9 });
	});
	afterEach(() => {
		(console.warn as jest.Mock).mockRestore();
	});

	it("shows only the assigned article on today's daily perek", async () => {
		mockGetDailyArticleOverride.mockResolvedValue(assignedArticle);

		render(<DailyArticlesSection perekId={55} articles={chapterArticles} />);

		await waitFor(() =>
			expect(screen.getByText("לימוד לתשעה באב")).toBeTruthy(),
		);
		expect(screen.queryByText("מאמר רגיל")).toBeNull();
	});

	it("keeps the chapter list on a different perek", async () => {
		mockGetDailyArticleOverride.mockResolvedValue(assignedArticle);

		render(<DailyArticlesSection perekId={42} articles={chapterArticles} />);

		await waitFor(() => expect(mockGetDailyArticleOverride).toHaveBeenCalled());
		expect(screen.getByText("מאמר רגיל")).toBeTruthy();
		expect(screen.queryByText("לימוד לתשעה באב")).toBeNull();
	});

	it("keeps the chapter list on an unassigned date", async () => {
		mockGetDailyArticleOverride.mockResolvedValue(null);

		render(<DailyArticlesSection perekId={55} articles={chapterArticles} />);

		await waitFor(() => expect(mockGetDailyArticleOverride).toHaveBeenCalled());
		expect(screen.getByText("מאמר רגיל")).toBeTruthy();
	});
});
