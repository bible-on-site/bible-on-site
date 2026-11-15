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
	return render(<Root />);
}

function session(data: unknown, status = 200) {
	global.fetch = vi.fn(
		async () =>
			({
				ok: status < 300,
				status,
				json: async () => data,
			}) as Response,
	);
}

describe("RootDocument", () => {
	beforeEach(() => {
		server.links.length = 0;
		server.pathname = "/";
		session({ error: "login" }, 401);
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
			"ארכיון",
			"תנכפדיה",
		]) {
			expect(screen.getByText(label)).toBeInTheDocument();
		}
		expect(screen.getByText("התנתק")).toBeInTheDocument();
	});

	it("renders no copyright symbol, year, or footer strip", () => {
		const { container } = renderRoot();

		expect(screen.queryByText(/©/)).not.toBeInTheDocument();
		expect(screen.queryByText(/\b20\d\d\b/)).not.toBeInTheDocument();
		expect(container.querySelector("footer")).toBeNull();
	});

	it.each(["/archive", "/archive/authors/מחבר"])(
		"keeps the shared top bar with the archive entry on %s",
		(path) => {
			server.pathname = path;
			renderRoot();
			expect(screen.getByRole("link", { name: "ארכיון" })).toBeInTheDocument();
		},
	);

	it("keeps the archive entry active through the shared link props", () => {
		server.pathname = "/archive/authors/מחבר";
		renderRoot();
		const archiveLink = server.links.find(
			(link) => link.to === "/archive" && link.children === "ארכיון",
		);
		expect(archiveLink?.activeProps).toBeDefined();
	});

	it("shows the full admin navigation on archive routes for administrators", async () => {
		server.pathname = "/archive";
		session({ isAdmin: true, username: "מנהל" });
		renderRoot();

		expect(await screen.findByText("מאמרים")).toBeInTheDocument();
		for (const label of ["בית", "רבנים", "ארכיון", "תנכפדיה"]) {
			expect(screen.getByText(label)).toBeInTheDocument();
		}
		expect(screen.getByRole("button", { name: "התנתק" })).toBeInTheDocument();
	});

	it("limits the archive top bar to archive actions for archiver sessions", async () => {
		server.pathname = "/archive/authors/מחבר";
		session({ isAdmin: false, username: "סופר" });
		renderRoot();

		expect(
			await screen.findByRole("button", { name: "יציאה מהחשבון" }),
		).toBeInTheDocument();
		expect(screen.getByText(/שלום, סופר/)).toBeInTheDocument();
		expect(screen.queryByText("מאמרים")).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "ארכיון" })).toBeInTheDocument();
	});

	it("keeps archive visitors without a session on the plain bar", () => {
		server.pathname = "/archive";
		renderRoot();

		expect(screen.getByRole("link", { name: "ארכיון" })).toBeInTheDocument();
		expect(screen.queryByText("מאמרים")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "התנתק" }),
		).not.toBeInTheDocument();
	});
});
