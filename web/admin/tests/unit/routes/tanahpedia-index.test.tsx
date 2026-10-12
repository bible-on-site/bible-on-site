import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	navigateMock,
	getTanahpediaCategoryCountsMock,
	listTanahpediaEntriesForAdminMock,
	searchState,
	matchState,
} = vi.hoisted(() => ({
	navigateMock: vi.fn(),
	getTanahpediaCategoryCountsMock: vi.fn(),
	listTanahpediaEntriesForAdminMock: vi.fn(),
	searchState: {
		category: undefined as string | undefined,
		q: undefined as string | undefined,
	},
	matchState: {
		entries: null as unknown,
		persons: null as unknown,
		places: null as unknown,
	},
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: { component: unknown }) => ({
		...config,
	}),
	Link: ({
		children,
		to,
		...rest
	}: {
		children: React.ReactNode;
		to?: string;
	}) => (
		<a href={to ?? "/"} {...rest}>
			{children}
		</a>
	),
	Outlet: () => <div data-testid="route-outlet" />,
	useMatch: ({ from }: { from: string }) => {
		if (from === "/tanahpedia/entries/$id") return matchState.entries;
		if (from === "/tanahpedia/persons") return matchState.persons;
		if (from === "/tanahpedia/places") return matchState.places;
		return null;
	},
	useNavigate: () => navigateMock,
	useSearch: () => ({
		category: searchState.category,
		q: searchState.q,
	}),
}));

vi.mock("~/server/tanahpedia/entries", () => ({
	getTanahpediaCategoryCounts: getTanahpediaCategoryCountsMock,
	listTanahpediaEntriesForAdmin: listTanahpediaEntriesForAdminMock,
}));

import { Route } from "~/routes/tanahpedia";

const entryRows = [
	{
		id: "entry-1",
		unique_name: "משה-רבנו",
		title: "משה רבנו",
		content: null,
		created_at: "2024-01-01",
		updated_at: "2024-06-01",
	},
];

function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { component: Page } = Route as unknown as {
		component: () => React.ReactElement;
	};
	render(
		<QueryClientProvider client={client}>
			<Page />
		</QueryClientProvider>,
	);
	return client;
}

describe("TanahpediaLayout", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		getTanahpediaCategoryCountsMock
			.mockReset()
			.mockResolvedValue({ counts: { PERSON: 3, PLACE: 2 } });
		listTanahpediaEntriesForAdminMock.mockReset().mockResolvedValue(entryRows);
		searchState.category = undefined;
		searchState.q = undefined;
		matchState.entries = null;
		matchState.persons = null;
		matchState.places = null;
	});

	it("renders the outlet instead of the index when an entry route matches", () => {
		matchState.entries = { id: "entry-1" };
		renderPage();

		expect(screen.getByTestId("route-outlet")).toBeInTheDocument();
		expect(screen.queryByText("תנכפדיה")).not.toBeInTheDocument();
	});

	it("renders the outlet when the persons route matches", () => {
		matchState.persons = {};
		renderPage();

		expect(screen.getByTestId("route-outlet")).toBeInTheDocument();
	});

	it("lists entries with counts and website links", async () => {
		renderPage();

		expect(await screen.findByText("משה רבנו")).toBeInTheDocument();
		expect(screen.getByText("משה-רבנו")).toBeInTheDocument();
		expect(screen.getByText("1 ערכים")).toBeInTheDocument();
		expect(screen.getByText("3 ערכים")).toBeInTheDocument();
		expect(
			screen.getAllByRole("link", { name: "אתר ↗" }).length,
		).toBeGreaterThan(0);
		expect(screen.getByRole("link", { name: "+ ערך חדש" })).toHaveAttribute(
			"href",
			"/tanahpedia/entries/$id",
		);
		expect(
			screen.getByRole("link", { name: "ניהול אישים (ישויות)" }),
		).toHaveAttribute("href", "/tanahpedia/persons");
		expect(
			screen.getByRole("link", { name: "ניהול מקומות (ישויות)" }),
		).toHaveAttribute("href", "/tanahpedia/places");

		await waitFor(() =>
			expect(getTanahpediaCategoryCountsMock).toHaveBeenCalledTimes(1),
		);
		expect(listTanahpediaEntriesForAdminMock).toHaveBeenCalledWith({
			data: { category: undefined, q: undefined },
		});
	});

	it("navigates when a category card is toggled on and off", async () => {
		searchState.category = "PERSON";
		renderPage();

		expect(await screen.findByText("מסנן פעיל:")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "הצג את כל הערכים" }));
		expect(navigateMock).toHaveBeenCalledWith(
			expect.objectContaining({ replace: true }),
		);
		const clearCall = navigateMock.mock.calls.at(-1)?.[0];
		expect(clearCall.search({ category: "PERSON" })).toEqual({
			category: undefined,
		});

		navigateMock.mockClear();
		fireEvent.click(
			screen.getAllByRole("button", {
				name: /מקומות/,
			})[0],
		);
		const toggleCall = navigateMock.mock.calls.at(-1)?.[0];
		expect(toggleCall.search({ category: "PERSON" })).toEqual({
			category: "PLACE",
		});
	});

	it("debounces the search input into a navigation update", async () => {
		renderPage();
		const input = await screen.findByPlaceholderText(
			"חיפוש לפי כותרת או שם ייחודי…",
		);

		fireEvent.change(input, { target: { value: "  משה  " } });

		await waitFor(
			() => {
				expect(navigateMock).toHaveBeenCalledWith(
					expect.objectContaining({ replace: true }),
				);
			},
			{ timeout: 2000 },
		);
		const call = navigateMock.mock.calls.at(-1)?.[0];
		expect(call.search({ q: undefined })).toEqual({ q: "משה" });
	});

	it("does not navigate when the trimmed query already matches the url", async () => {
		searchState.q = "משה";
		renderPage();
		const input = await screen.findByPlaceholderText(
			"חיפוש לפי כותרת או שם ייחודי…",
		);
		expect(input).toHaveValue("משה");

		fireEvent.change(input, { target: { value: "  משה  " } });
		await new Promise((resolve) => setTimeout(resolve, 450));

		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("clears the query via the clear button", async () => {
		searchState.q = "משה";
		renderPage();

		fireEvent.click(await screen.findByRole("button", { name: "נקה חיפוש" }));

		const call = navigateMock.mock.calls.at(-1)?.[0];
		expect(call.search({ q: "משה" })).toEqual({ q: undefined });
	});

	it("shows the empty-filter message when no entries match", async () => {
		listTanahpediaEntriesForAdminMock.mockResolvedValue([]);
		renderPage();

		expect(
			await screen.findByText("אין ערכים התואמים לסינון"),
		).toBeInTheDocument();
	});

	it("shows loading placeholders while queries are pending", () => {
		getTanahpediaCategoryCountsMock.mockReturnValue(
			new Promise(() => undefined),
		);
		listTanahpediaEntriesForAdminMock.mockReturnValue(
			new Promise(() => undefined),
		);
		renderPage();

		expect(screen.getByText("טוען…")).toBeInTheDocument();
		expect(document.querySelector(".animate-spin")).not.toBeNull();
		expect(screen.getAllByText("…").length).toBeGreaterThan(0);
	});
});
