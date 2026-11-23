/**
 * Unit tests for the daily Hebrew-date article override UI path (#3098):
 * the swap hook plus the DailyArticlesSection wrapper used by the flat and
 * slug pages, and the panel selection Sefer relies on.
 */

import {
	act,
	render,
	renderHook,
	screen,
	waitFor,
} from "@testing-library/react";
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

	describe("when the tab is hidden and shown again", () => {
		const setVisibility = (state: "visible" | "hidden") => {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				value: state,
			});
		};

		beforeEach(() => {
			jest.useFakeTimers();
			mockGetPerekIdByDate.mockReturnValue(55);
			mockConstructHDate.mockReturnValue({ getUniformMonth: () => 11, day: 9 });
			mockGetDailyArticleOverride.mockResolvedValue(null);
		});
		afterEach(() => {
			jest.useRealTimers();
			// Drop the mocked property so later tests get the jsdom default.
			delete (document as { visibilityState?: string }).visibilityState;
		});

		it("does not refetch when the tab is hidden", async () => {
			const { unmount } = renderHook(() => useDailyArticleOverride());
			await act(async () => {});
			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(1);

			// Well past any dedupe window: the hidden event alone decides.
			act(() => jest.advanceTimersByTime(2_000));
			setVisibility("hidden");
			act(() => document.dispatchEvent(new Event("visibilitychange")));
			await act(async () => {});
			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(1);
			unmount();
		});

		it("coalesces visibilitychange and focus into one refetch on return", async () => {
			const { unmount } = renderHook(() => useDailyArticleOverride());
			await act(async () => {});
			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(1);

			for (let cycle = 0; cycle < 2; cycle++) {
				act(() => jest.advanceTimersByTime(2_000));
				setVisibility("hidden");
				act(() => document.dispatchEvent(new Event("visibilitychange")));
				act(() => jest.advanceTimersByTime(2_000));
				setVisibility("visible");
				// Chrome fires both events when a hidden tab is re-shown.
				act(() => {
					document.dispatchEvent(new Event("visibilitychange"));
					window.dispatchEvent(new Event("focus"));
				});
				await act(async () => {});
				expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(2 + cycle);
			}
			unmount();
		});

		it("still refetches on the 60-second interval", async () => {
			const { unmount } = renderHook(() => useDailyArticleOverride());
			await act(async () => {});
			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(1);

			act(() => jest.advanceTimersByTime(60_000));
			await act(async () => {});
			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(2);
			unmount();
		});
	});

	describe("when several components consume the hook", () => {
		const setVisibility = (state: "visible" | "hidden") => {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				value: state,
			});
		};

		beforeEach(() => {
			jest.useFakeTimers();
			mockGetPerekIdByDate.mockReturnValue(55);
			mockConstructHDate.mockReturnValue({ getUniformMonth: () => 11, day: 9 });
			mockGetDailyArticleOverride.mockResolvedValue(assignedArticle);
			setVisibility("visible");
		});
		afterEach(() => {
			jest.useRealTimers();
			delete (document as { visibilityState?: string }).visibilityState;
		});

		it("runs a single mount lookup for two mounted consumers", async () => {
			// DailyArticlesSection plus the kept-mounted Sefer share one store.
			const first = renderHook(() => useDailyArticleOverride());
			const second = renderHook(() => useDailyArticleOverride());
			await act(async () => {});

			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(1);
			expect(second.result.current).toEqual(first.result.current);
			expect(first.result.current).toEqual({
				perekId: 55,
				articles: [assignedArticle],
			});
			first.unmount();
			second.unmount();
		});

		it("runs one interval tick and one reactivate fetch for two consumers", async () => {
			const first = renderHook(() => useDailyArticleOverride());
			const second = renderHook(() => useDailyArticleOverride());
			await act(async () => {});
			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(1);

			act(() => jest.advanceTimersByTime(60_000));
			await act(async () => {});
			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(2);

			// Past the one-second coalesce window; both reactivate events fire.
			act(() => jest.advanceTimersByTime(2_000));
			act(() => {
				document.dispatchEvent(new Event("visibilitychange"));
				window.dispatchEvent(new Event("focus"));
			});
			await act(async () => {});
			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(3);
			first.unmount();
			second.unmount();
		});

		it("stops polling once the last consumer unmounts", async () => {
			const first = renderHook(() => useDailyArticleOverride());
			const second = renderHook(() => useDailyArticleOverride());
			await act(async () => {});
			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(1);

			// One consumer leaving keeps polling alive for the other.
			second.unmount();
			act(() => jest.advanceTimersByTime(60_000));
			await act(async () => {});
			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(2);

			// Last consumer leaving stops the interval entirely.
			first.unmount();
			act(() => jest.advanceTimersByTime(120_000));
			await act(async () => {});
			expect(mockGetDailyArticleOverride).toHaveBeenCalledTimes(2);
		});
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
