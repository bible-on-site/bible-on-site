/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";

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

import { metadata } from "@/app/search/page";
import SearchPage from "@/app/search/page";
import { searchSite } from "@/lib/search/service";
import type { SearchResponse } from "@/lib/search/types";

const mockSearch = searchSite as jest.MockedFunction<typeof searchSite>;

const RESULTS: SearchResponse = {
	query: "בראשית",
	types: ["perek", "pasuk", "perush", "author", "article"],
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

function paramsFor(search: Record<string, string>) {
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
		expect(
			screen.getByText('לא נמצאו תוצאות עבור "זזז"'),
		).toBeInTheDocument();
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

	it("keeps only valid filter types from the URL", async () => {
		await SearchPage({
			searchParams: paramsFor({ q: "את", type: "perek,bogus" }),
		});
		expect(mockSearch).toHaveBeenCalledWith(
			"את",
			["perek"],
			expect.anything(),
		);
	});
});
