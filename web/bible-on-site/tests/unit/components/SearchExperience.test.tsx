/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";

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

import { SearchExperience } from "@/app/search/components/SearchExperience";
import type { SearchResponse, SearchResultType } from "@/lib/search/types";

const RESULTS: SearchResponse = {
	query: "את",
	types: ["perek", "pasuk", "perush", "author", "article"],
	results: [
		{
			type: "perek",
			title: "בראשית א",
			snippetHtml: "<mark>את</mark> השמים",
			href: "/929/1",
			score: 90,
		},
	],
	counts: { perek: 1 },
	availability: [],
};

const ALL_TYPES: SearchResultType[] = [
	"perek",
	"pasuk",
	"perush",
	"author",
	"article",
];

/** Two perek results (one without a snippet) plus an availability notice. */
const TWO_RESULTS: SearchResponse = {
	...RESULTS,
	results: [
		...RESULTS.results,
		{
			type: "perek",
			title: "בראשית ב",
			snippetHtml: null,
			href: "/929/2",
			score: 80,
		},
	],
	counts: { perek: 2 },
	availability: ["חיפוש הפירושים אינו זמין כרגע"],
};

const realFetch = global.fetch;
const mockFetch = jest.fn();

const realPushState = window.history.pushState.bind(window.history);

/** Simulate an external history traversal landing on `url`. */
function popTo(url: string) {
	realPushState(window.history.state, "", url);
	window.dispatchEvent(new Event("popstate"));
}

function renderSearch(
	props: Partial<Parameters<typeof SearchExperience>[0]> = {},
) {
	const query = props.initialQuery ?? "";
	const url = query
		? `/search?q=${encodeURIComponent(query)}`
		: "/search";
	window.history.replaceState(window.history.state, "", url);
	return render(
		<SearchExperience
			initialQuery={query}
			initialTypes={ALL_TYPES}
			initialResults={null}
			{...props}
		/>,
	);
}

async function settle() {
	await act(async () => {
		jest.advanceTimersByTime(350);
	});
}

describe("SearchExperience", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => RESULTS,
		});
		global.fetch = mockFetch;
	});

	afterEach(() => {
		jest.useRealTimers();
		global.fetch = realFetch;
	});

	it("renders the SSR results on first paint", () => {
		renderSearch({
			initialQuery: "את",
			initialResults: RESULTS,
		});
		expect(screen.getByRole("link", { name: /בראשית א/ })).toHaveAttribute(
			"href",
			"/929/1",
		);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("debounces typing into a settled history entry and fetches results", async () => {
		renderSearch();
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		fireEvent.change(input, { target: { value: "את" } });
		// Before the debounce, nothing is fetched and the URL is untouched.
		expect(mockFetch).not.toHaveBeenCalled();
		expect(window.location.search).toBe("");
		await settle();
		expect(window.location.search).toBe("?q=%D7%90%D7%AA");
		await act(async () => {});
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("/api/search?q="),
			expect.anything(),
		);
		expect(
			await screen.findByRole("link", { name: /בראשית א/ }),
		).toBeInTheDocument();
	});

	it("restores the previous query and cached results on Back", async () => {
		renderSearch();
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		fireEvent.change(input, { target: { value: "את" } });
		await settle();
		await act(async () => {});
		fireEvent.change(input, { target: { value: "אתה" } });
		await settle();
		await act(async () => {});
		expect(window.location.search).toContain("D7%94");
		expect(mockFetch).toHaveBeenCalledTimes(2);
		// A Back navigation lands on the earlier entry: the URL reverts and a
		// popstate notifies the component to adopt it.
		await act(async () => {
			popTo("/search?q=%D7%90%D7%AA");
		});
		expect((input as HTMLInputElement).value).toBe("את");
		// Results come back from the client cache without a refetch.
		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(
			await screen.findByRole("link", { name: /בראשית א/ }),
		).toBeInTheDocument();
	});

	it("adds a type filter to the URL and the API call when toggled", async () => {
		renderSearch();
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		fireEvent.change(input, { target: { value: "את" } });
		await settle();
		await act(async () => {});
		fireEvent.click(screen.getByRole("checkbox", { name: "פסוקים" }));
		await act(async () => {});
		expect(window.location.search).toContain("type=");
		expect(mockFetch).toHaveBeenLastCalledWith(
			expect.stringContaining("type="),
			expect.anything(),
		);
	});

	it("shows the error state when the fetch fails", async () => {
		mockFetch.mockResolvedValue({ ok: false, status: 500 });
		renderSearch();
		fireEvent.change(screen.getByRole("searchbox", { name: "מונח חיפוש" }), {
			target: { value: "את" },
		});
		await settle();
		await act(async () => {});
		expect(screen.getByRole("status")).toHaveTextContent("שגיאה בחיפוש");
	});

	it("moves focus through results with arrow keys and back to the input", async () => {
		renderSearch({ initialQuery: "את", initialResults: RESULTS });
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		input.focus();
		fireEvent.keyDown(input, { key: "ArrowDown" });
		const link = screen.getByRole("link", { name: /בראשית א/ });
		expect(link).toHaveFocus();
		fireEvent.keyDown(link, { key: "ArrowUp" });
		expect(input).toHaveFocus();
	});

	it("clears the query and the URL with Escape in the input", async () => {
		renderSearch();
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		fireEvent.change(input, { target: { value: "את" } });
		await settle();
		expect(window.location.search).toBe("?q=%D7%90%D7%AA");
		fireEvent.keyDown(input, { key: "Escape" });
		await act(async () => {});
		expect((input as HTMLInputElement).value).toBe("");
		expect(window.location.search).toBe("");
	});

	it("settles immediately on submit, and a redundant submit is a no-op", async () => {
		renderSearch();
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		fireEvent.change(input, { target: { value: "את" } });
		fireEvent.submit(input.closest("form") as HTMLFormElement);
		expect(window.location.search).toBe("?q=%D7%90%D7%AA");
		await act(async () => {});
		expect(mockFetch).toHaveBeenCalledTimes(1);
		// Same state again: the URL is already canonical, so settle returns
		// early and no second fetch is issued.
		fireEvent.submit(input.closest("form") as HTMLFormElement);
		await act(async () => {});
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("restores the unfiltered canonical URL when a filter is re-checked", async () => {
		renderSearch();
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		fireEvent.change(input, { target: { value: "את" } });
		await settle();
		await act(async () => {});
		const box = screen.getByRole("checkbox", { name: "פסוקים" });
		fireEvent.click(box);
		await act(async () => {});
		expect(window.location.search).toContain("type=");
		fireEvent.click(box);
		await act(async () => {});
		expect(window.location.search).toBe("?q=%D7%90%D7%AA");
	});

	it("adopts the filter carried by a restored URL on Back", async () => {
		renderSearch({ initialQuery: "את", initialResults: RESULTS });
		await act(async () => {
			popTo("/search?q=%D7%90%D7%AA&type=perek");
		});
		expect(screen.getByRole("checkbox", { name: "פרקים" })).toBeChecked();
		expect(screen.getByRole("checkbox", { name: "פסוקים" })).not.toBeChecked();
	});

	it("ignores ArrowDown when there are no result links", () => {
		renderSearch();
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		input.focus();
		fireEvent.keyDown(input, { key: "ArrowDown" });
		expect(input).toHaveFocus();
	});

	it("ignores Escape in an empty input", () => {
		renderSearch();
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		input.focus();
		fireEvent.keyDown(input, { key: "Escape" });
		expect((input as HTMLInputElement).value).toBe("");
		expect(window.location.search).toBe("");
	});

	it("cycles focus between result links and back to the input", () => {
		renderSearch({ initialQuery: "את", initialResults: TWO_RESULTS });
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		input.focus();
		fireEvent.keyDown(input, { key: "ArrowDown" });
		const first = screen.getByRole("link", { name: /בראשית א/ });
		const second = screen.getByRole("link", { name: "בראשית ב" });
		expect(first).toHaveFocus();
		fireEvent.keyDown(first, { key: "ArrowDown" });
		expect(second).toHaveFocus();
		fireEvent.keyDown(second, { key: "ArrowUp" });
		expect(first).toHaveFocus();
		fireEvent.keyDown(first, { key: "Escape" });
		expect(input).toHaveFocus();
	});

	it("renders availability notices and results without snippets", () => {
		renderSearch({ initialQuery: "את", initialResults: TWO_RESULTS });
		expect(
			screen.getByText("חיפוש הפירושים אינו זמין כרגע"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "בראשית ב" }),
		).toBeInTheDocument();
	});

	it("drops the response of a fetch aborted by a newer settled state", async () => {
		// The first fetch hangs until its AbortSignal fires.
		mockFetch.mockImplementationOnce(
			(_url: string, init?: { signal?: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new Error("aborted")),
					);
				}),
		);
		renderSearch();
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		fireEvent.change(input, { target: { value: "את" } });
		await settle();
		fireEvent.change(input, { target: { value: "אתה" } });
		await settle();
		await act(async () => {});
		// No error state from the abandoned fetch; the newer response wins.
		expect(screen.getByRole("status")).not.toHaveTextContent("שגיאה");
		expect(
			await screen.findByRole("link", { name: /בראשית א/ }),
		).toBeInTheDocument();
	});

	it("shows the error state for a non-Error rejection", async () => {
		mockFetch.mockRejectedValue("plain failure");
		renderSearch();
		fireEvent.change(screen.getByRole("searchbox", { name: "מונח חיפוש" }), {
			target: { value: "את" },
		});
		await settle();
		await act(async () => {});
		expect(screen.getByRole("status")).toHaveTextContent("שגיאה בחיפוש");
	});

	it("evicts the oldest cached response past the cache cap", async () => {
		renderSearch();
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		// Sequential settled states are the point: each fills one cache slot.
		for (let i = 0; i < 31; i++) {
			fireEvent.change(input, { target: { value: `q${i}` } });
			await settle();
			await act(async () => {});
		}
		expect(mockFetch).toHaveBeenCalledTimes(31);
		// q0 was evicted — going Back to it must refetch instead of hitting
		// the cache.
		await act(async () => {
			popTo("/search?q=q0");
		});
		expect(mockFetch).toHaveBeenCalledTimes(32);
	});

	it("adopts a fresh SSR payload when the page props change", async () => {
		const { rerender } = renderSearch({
			initialQuery: "את",
			initialResults: RESULTS,
		});
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		rerender(
			<SearchExperience
				initialQuery="זזז"
				initialTypes={ALL_TYPES}
				initialResults={null}
				initialError
			/>,
		);
		expect((input as HTMLInputElement).value).toBe("זזז");
		expect(screen.getByRole("status")).toHaveTextContent("שגיאה בחיפוש");
		rerender(
			<SearchExperience
				initialQuery=""
				initialTypes={ALL_TYPES}
				initialResults={null}
			/>,
		);
		expect((input as HTMLInputElement).value).toBe("");
	});
});
