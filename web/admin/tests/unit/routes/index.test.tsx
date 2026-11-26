import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ search: {} as Record<string, unknown> }));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: unknown) => ({
		options,
		useSearch: () => route.search,
	}),
}));
vi.mock("~/components/tanahpedia/ContributionWorkspace", () => ({
	ContributionWorkspace: ({ kind }: { kind: string }) => <h1>{kind}</h1>,
	validateContributionHomeSearch: (search: unknown) => search,
}));

import { Route } from "~/routes/index";

function Page() {
	const Component = (
		Route as unknown as { options: { component?: () => ReactNode } }
	).options.component;
	if (!Component) throw new Error("Home route component is missing");
	return <Component />;
}

describe("Admin home", () => {
	it.each([
		[{}, "issue"],
		[{ tab: "prs" }, "pr"],
	])("opens directly in the requested contribution queue", (search, kind) => {
		route.search = search;
		render(<Page />);
		expect(screen.getByRole("heading", { level: 1, name: kind })).toBeVisible();
		expect(screen.queryByRole("link")).toBeNull();
	});
});
