import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: unknown) => config,
	Link: () => null,
	Outlet: () => null,
	useMatch: vi.fn(),
	useNavigate: vi.fn(),
	useSearch: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("~/server/tanahpedia/entries", () => ({
	getTanahpediaCategoryCounts: vi.fn(),
	listTanahpediaEntriesForAdmin: vi.fn(),
}));

import { Route } from "~/routes/tanahpedia";

type Search = Record<string, unknown>;

const validateSearch = (
	Route as unknown as { validateSearch: (search: Search) => unknown }
).validateSearch;

describe("/tanahpedia search params validation", () => {
	it("keeps a known category and a string query", () => {
		expect(validateSearch({ category: "person", q: "משה" })).toEqual({
			category: "PERSON",
			q: "משה",
		});
	});

	it("trims and uppercases the category before matching", () => {
		expect(validateSearch({ category: "  place  " })).toEqual({
			category: "PLACE",
			q: undefined,
		});
	});

	it.each([
		{ category: "not-a-category" },
		{ category: 42 },
		{ category: null },
	])("drops an unrecognized category %j", (search) => {
		expect(validateSearch(search)).toEqual({
			category: undefined,
			q: undefined,
		});
	});

	it("drops a non-string query", () => {
		expect(validateSearch({ q: 17 })).toEqual({
			category: undefined,
			q: undefined,
		});
	});
});
