import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
	getArticles: vi.fn(),
	getAuthors: vi.fn(),
	listDedications: vi.fn(),
	listMoadim: vi.fn(),
	search: { value: {} as Record<string, unknown> },
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: unknown) => ({
		options,
		useSearch: () => server.search.value,
	}),
	Link: ({
		children,
		to,
		className,
	}: {
		children: ReactNode;
		to: string;
		className?: string;
	}) => (
		<a className={className} href={to}>
			{children}
		</a>
	),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryFn }: { queryFn: () => unknown }) => ({ data: queryFn() }),
}));
vi.mock("~/components/tanahpedia/ContributionWorkspace", () => ({
	ContributionWorkspace: () => <div data-testid="workspace" />,
	validateContributionHomeSearch: (search: unknown) => search,
}));
vi.mock("~/server/articles", () => ({ getArticles: server.getArticles }));
vi.mock("~/server/authors", () => ({ getAuthors: server.getAuthors }));
vi.mock("~/server/dedications", () => ({
	listDedications: server.listDedications,
}));
vi.mock("~/server/moadim", () => ({ listMoadim: server.listMoadim }));

import { Route } from "~/routes/index";

function Page() {
	const Component = (
		Route as unknown as { options: { component?: () => ReactNode } }
	).options.component;
	if (!Component) throw new Error("Home route component is missing");
	return <Component />;
}

beforeEach(() => {
	server.search.value = {};
	server.getArticles.mockReset().mockReturnValue([1, 2, 3]);
	server.getAuthors.mockReset().mockReturnValue([1, 2]);
	server.listDedications.mockReset().mockReturnValue([1]);
	server.listMoadim.mockReset().mockReturnValue([1, 2, 3, 4]);
});

describe("Home dashboard", () => {
	it("shows live counts on cards that each link to their page", () => {
		render(<Page />);
		expect(screen.getByRole("link", { name: /מאמרים\s*3/ })).toHaveAttribute(
			"href",
			"/articles",
		);
		expect(screen.getByRole("link", { name: /רבנים\s*2/ })).toHaveAttribute(
			"href",
			"/rabbis",
		);
		expect(
			screen.getByRole("link", { name: /הקדשות פעילות\s*1/ }),
		).toHaveAttribute("href", "/dedications");
		expect(screen.getByRole("link", { name: /מועדים\s*4/ })).toHaveAttribute(
			"href",
			"/moadim",
		);
		const bulletin = screen.getByRole("link", { name: /עלון יומי/ });
		expect(bulletin).toHaveAttribute("href", "/bulletins");
		expect(bulletin.textContent).not.toBe("עלון יומי");
		expect(server.listDedications).toHaveBeenCalledWith({
			data: { show: "active" },
		});
	});

	it("keeps the cards linked while counts are pending", () => {
		server.getArticles.mockReturnValue(undefined);
		server.getAuthors.mockReturnValue(undefined);
		server.listDedications.mockReturnValue(undefined);
		server.listMoadim.mockReturnValue(undefined);
		render(<Page />);
		expect(screen.getByRole("link", { name: /מאמרים\s*-/ })).toHaveAttribute(
			"href",
			"/articles",
		);
		expect(screen.getByRole("link", { name: /מועדים\s*-/ })).toHaveAttribute(
			"href",
			"/moadim",
		);
	});

	it("hides the stats while a single contribution is open", () => {
		server.search.value = { id: "some-uuid" };
		render(<Page />);
		expect(screen.queryByRole("link", { name: /מאמרים/ })).toBeNull();
		expect(screen.getByTestId("workspace")).toBeInTheDocument();
	});
});
