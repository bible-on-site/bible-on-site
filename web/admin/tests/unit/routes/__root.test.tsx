import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
	links: [] as Record<string, unknown>[],
	pathname: "/",
}));

vi.mock("@tanstack/react-router", () => ({
	createRootRoute: (config: Record<string, unknown>) => config,
	useRouterState: ({
		select,
	}: {
		select: (state: { location: { pathname: string } }) => boolean;
	}) => select({ location: { pathname: server.pathname } }),
	HeadContent: () => null,
	Link: (props: {
		children?: React.ReactNode;
		to?: string;
		className?: string;
		[key: string]: unknown;
	}) => {
		server.links.push(props);
		return <a href={props.to}>{props.children}</a>;
	},
	Outlet: () => null,
	Scripts: () => null,
}));
vi.mock("@tanstack/react-router-devtools", () => ({
	TanStackRouterDevtools: () => null,
}));
vi.mock("~/components/RevalidationWarning", () => ({
	RevalidationWarning: () => null,
}));

import { Route } from "~/routes/__root";

function renderRoot() {
	const { component: Root } = Route as unknown as {
		component: () => React.ReactElement;
	};
	render(<Root />);
}

describe("RootDocument", () => {
	beforeEach(() => {
		server.links.length = 0;
		server.pathname = "/";
	});

	it("renders the link-proposals nav entry for the proposals queue", () => {
		renderRoot();

		const proposalsLink = server.links.find(
			(link) => link.to === "/link-proposals",
		);
		expect(proposalsLink).toMatchObject({
			search: { articleId: undefined },
		});
		expect(
			screen.getByText("הצעות קישור", { selector: "*" }),
		).toBeInTheDocument();
	});

	it("renders the remaining primary navigation entries", () => {
		renderRoot();

		for (const label of [
			"בית",
			"מאמרים",
			"עלון יומי",
			"מועדים",
			"הקדשות",
			"רבנים",
			"תנכפדיה",
		]) {
			expect(screen.getByText(label)).toBeInTheDocument();
		}
		expect(screen.getByText(/ניהול תנ"ך על הפרק ©/)).toBeInTheDocument();
		expect(screen.getByText("התנתק")).toBeInTheDocument();
	});
});

it.each(["/archive", "/archive/authors/מחבר"])(
	"hides all general admin navigation on %s",
	(path) => {
		server.links.length = 0;
		server.pathname = path;
		renderRoot();
		expect(screen.queryByText("מאמרים")).not.toBeInTheDocument();
		expect(server.links).toHaveLength(0);
	},
);
