/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

jest.mock("@/lib/search/service", () => ({
	...jest.requireActual("@/lib/search/service"),
	searchSite: jest.fn(),
}));

jest.mock("next/image", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => (
		<span data-testid="mock-image" data-alt={props.alt as string} />
	),
}));

import { SearchExperience } from "@/app/search/components/SearchExperience";
import SearchPage, { metadata } from "@/app/search/page";
import { searchSite } from "@/lib/search/service";
import { SEARCH_RESULT_TYPES, type SearchResponse } from "@/lib/search/types";

const mockSearch = searchSite as jest.MockedFunction<typeof searchSite>;

const RESULTS: SearchResponse = {
	query: "בראשית",
	types: ["perek", "pasuk", "perush", "author", "article", "tanahpedia"],
	results: [
		{
			type: "perek",
			title: "בראשית א",
			snippetHtml: "<mark>בראשית</mark> העולם",
			href: "/929/1",
			score: 100,
		},
	],
	counts: { perek: 1 },
	availability: [],
};

function paramsFor(search: Record<string, string | string[]>) {
	return Promise.resolve(search) as Promise<
		Record<string, string | string[] | undefined>
	>;
}

describe("metadata", () => {
	it("marks search pages noindex but allows following result links", () => {
		expect(metadata.robots).toEqual(
			expect.objectContaining({ index: false, follow: true }),
		);
		expect(metadata.title).toContain("חיפוש");
	});
});

describe("SearchPage", () => {
	it("keeps the SSR input enabled so the native GET form works without JavaScript", async () => {
		const page = await SearchPage({ searchParams: paramsFor({}) });
		expect(renderToString(page)).not.toMatch(/<input[^>]*disabled/);
		render(page);
		const input = screen.getByRole("searchbox", { name: "מונח חיפוש" });
		expect(input).toBeEnabled();
		const form = input.closest("form");
		// The current accessibility-query data predates HTML search's implicit role.
		expect(form?.parentElement?.tagName).toBe("SEARCH");
		expect(form?.parentElement).toBeInstanceOf(HTMLElement);
		expect(form).toHaveAttribute("action", "/search");
		expect(form).toHaveAttribute("method", "get");
		expect(form).toContainElement(input);
	});

	it("adopts text typed before hydration instead of dropping it", async () => {
		const page = await SearchPage({ searchParams: paramsFor({}) });
		const container = document.createElement("div");
		container.append(
			...new DOMParser().parseFromString(renderToString(page), "text/html").body
				.childNodes,
		);
		const input = container.querySelector("input[name=q]") as HTMLInputElement;
		input.value = "בראשית";
		await act(async () => {
			hydrateRoot(container, page);
		});
		expect(input.value).toBe("בראשית");
	});
	beforeEach(() => {
		jest.clearAllMocks();
		mockSearch.mockResolvedValue(RESULTS);
	});

	it("renders the search form and SSR results for the query", async () => {
		render(await SearchPage({ searchParams: paramsFor({ q: "בראשית" }) }));
		expect(mockSearch).toHaveBeenCalledWith(
			"בראשית",
			expect.arrayContaining(["perek", "pasuk"]),
			expect.objectContaining({ limit: expect.any(Number) }),
		);
		expect(
			screen.getByRole("searchbox", { name: "מונח חיפוש" }),
		).toBeInTheDocument();
		const link = screen.getByRole("link", { name: /בראשית א/ });
		expect(link).toHaveAttribute("href", "/929/1");
		expect(link.innerHTML).toContain("<mark>");
	});

	it("announces the result count in the live status region", async () => {
		render(await SearchPage({ searchParams: paramsFor({ q: "בראשית" }) }));
		expect(screen.getByRole("status")).toHaveTextContent("נמצאו 1 תוצאות");
	});

	it("shows the empty state when nothing matches", async () => {
		mockSearch.mockResolvedValue({ ...RESULTS, results: [], counts: {} });
		render(await SearchPage({ searchParams: paramsFor({ q: "זזז" }) }));
		expect(screen.getByText('לא נמצאו תוצאות עבור "זזז"')).toBeInTheDocument();
	});

	it("shows the prompt state without a query and does not search", async () => {
		render(await SearchPage({ searchParams: paramsFor({}) }));
		expect(mockSearch).not.toHaveBeenCalled();
		expect(screen.getByText(/הקלידו מונח חיפוש/)).toBeInTheDocument();
	});

	it("renders the error state when the SSR search fails", async () => {
		mockSearch.mockRejectedValue(new Error("db down"));
		jest.spyOn(console, "error").mockImplementation(() => {});
		// The client retries after an SSR failure; jsdom has no fetch, and the
		// retry failure is logged via console.warn — keep the output clean.
		jest.spyOn(console, "warn").mockImplementation(() => {});
		render(await SearchPage({ searchParams: paramsFor({ q: "בראשית" }) }));
		expect(screen.getByRole("status")).toHaveTextContent("שגיאה בחיפוש");
	});

	it("uses the first value when q is repeated in the URL", async () => {
		await SearchPage({
			searchParams: paramsFor({ q: ["את", "בת"] }),
		});
		expect(mockSearch).toHaveBeenCalledWith(
			"את",
			expect.anything(),
			expect.anything(),
		);
	});

	it("reports non-Error SSR failures the same way", async () => {
		mockSearch.mockRejectedValue("plain failure");
		jest.spyOn(console, "error").mockImplementation(() => {});
		jest.spyOn(console, "warn").mockImplementation(() => {});
		render(await SearchPage({ searchParams: paramsFor({ q: "את" }) }));
		expect(screen.getByRole("status")).toHaveTextContent("שגיאה בחיפוש");
	});

	it("keeps only valid filter types from the URL", async () => {
		await SearchPage({
			searchParams: paramsFor({ q: "את", type: "perek,bogus" }),
		});
		expect(mockSearch).toHaveBeenCalledWith("את", ["perek"], expect.anything());
	});
});

describe("SearchExperience", () => {
	it("adopts a Back navigation that removes the query", () => {
		render(
			<SearchExperience
				initialQuery="בראשית"
				initialTypes={[...SEARCH_RESULT_TYPES]}
				initialResults={RESULTS}
			/>,
		);
		act(() => {
			window.history.pushState(null, "", "/search?type=perek");
			window.dispatchEvent(new Event("popstate"));
		});
		expect(screen.getByRole("searchbox", { name: "מונח חיפוש" })).toHaveValue(
			"",
		);
	});

	it("adopts a fresh SSR payload when the page props change", () => {
		// The settled query triggers a client fetch; jsdom has none, so the
		// failure warning is silenced here.
		jest.spyOn(console, "warn").mockImplementation(() => {});
		const { rerender } = render(
			<SearchExperience
				initialQuery="א"
				initialTypes={[...SEARCH_RESULT_TYPES]}
				initialResults={null}
			/>,
		);
		rerender(
			<SearchExperience
				initialQuery="ב"
				initialTypes={[...SEARCH_RESULT_TYPES]}
				initialResults={RESULTS}
			/>,
		);
		expect(screen.getByRole("searchbox", { name: "מונח חיפוש" })).toHaveValue(
			"ב",
		);
	});

	it("leaves result links alone on unhandled keys but refocuses on Escape", () => {
		render(
			<SearchExperience
				initialQuery="בראשית"
				initialTypes={[...SEARCH_RESULT_TYPES]}
				initialResults={RESULTS}
			/>,
		);
		const link = screen.getByRole("link", { name: /בראשית א/ });
		fireEvent.keyDown(link, { key: "Enter" });
		fireEvent.keyDown(link, { key: "Escape" });
		expect(screen.getByRole("searchbox", { name: "מונח חיפוש" })).toHaveFocus();
	});
});
