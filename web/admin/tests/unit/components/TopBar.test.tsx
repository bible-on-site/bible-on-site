import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
	Link: (props: {
		children?: React.ReactNode;
		to?: string;
		className?: string;
		[key: string]: unknown;
	}) => (
		<a href={props.to} className={props.className}>
			{props.children}
		</a>
	),
}));

import { TopBar } from "~/components/TopBar";
import { setArchiveBusy } from "~/lib/archive-busy";

const reply = (data: unknown, ok = true, status = ok ? 200 : 500) =>
	({
		ok,
		status,
		json: async () => JSON.parse(JSON.stringify(data)),
	}) as Response;

function renderBar(archive = true) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<TopBar archive={archive} />
		</QueryClientProvider>,
	);
}

describe("TopBar", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = vi.fn(async () =>
			reply({ error: "login" }, false, 401),
		) as Mock;
	});

	it("keeps the admin navigation and the classic logout outside the archive", () => {
		renderBar(false);

		expect(screen.getByRole("link", { name: "מאמרים" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "התנתק" })).toHaveAttribute(
			"href",
			"/auth/logout",
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("offers only the archive entry until the session resolves", () => {
		renderBar();

		expect(screen.getByRole("link", { name: "ארכיון" })).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "מאמרים" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "יציאה מהחשבון" }),
		).not.toBeInTheDocument();
	});

	it("restores the full navigation and admin logout for administrators", async () => {
		(fetch as Mock).mockImplementation(async (url: string) =>
			url === "/archive/api?session"
				? reply({ isAdmin: true, username: "admin@example.org" })
				: reply({ url: "https://sso.example/logout" }),
		);
		renderBar();

		expect(
			await screen.findByRole("link", { name: "מאמרים" }),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "ארכיון" })).toBeInTheDocument();
		expect(
			screen.queryByText(/שלום,/, { exact: false }),
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "התנתק" }));
		await waitFor(() =>
			expect(fetch).toHaveBeenCalledWith(
				"/archive/api?logout",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ action: "logout" }),
				}),
			),
		);
	});

	it("greets archivers and keeps them on the archive logout", async () => {
		(fetch as Mock).mockImplementation(async (url: string) =>
			url === "/archive/api?session"
				? reply({ isAdmin: false, username: "סופר" })
				: reply({ url: "https://auth.example/logout" }),
		);
		renderBar();

		expect(await screen.findByText(/שלום, סופר/)).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "מאמרים" }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "ארכיון" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "יציאה מהחשבון" }));
		await waitFor(() =>
			expect(fetch).toHaveBeenCalledWith(
				"/archive/api?logout",
				expect.objectContaining({ method: "POST" }),
			),
		);
	});

	it("keeps the archive logout disabled while archive work is in flight", async () => {
		(fetch as Mock).mockImplementation(async (url: string) =>
			url === "/archive/api?session"
				? reply({ isAdmin: false, username: "סופר" })
				: reply({ url: "https://auth.example/logout" }),
		);
		renderBar();
		const logout = await screen.findByRole("button", {
			name: "יציאה מהחשבון",
		});
		expect(logout).toBeEnabled();
		act(() => setArchiveBusy(true));
		await waitFor(() => expect(logout).toBeDisabled());
		act(() => setArchiveBusy(false));
		await waitFor(() => expect(logout).toBeEnabled());
	});

	it("reports logout failures inline", async () => {
		(fetch as Mock).mockImplementation(async (url: string) =>
			url === "/archive/api?session"
				? reply({ isAdmin: false, username: "סופר" })
				: reply({ error: "logout failed" }, false),
		);
		renderBar();

		fireEvent.click(
			await screen.findByRole("button", { name: "יציאה מהחשבון" }),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent("logout failed");
	});

	it("leaves logged-out visitors on the brand bar only", async () => {
		renderBar();

		expect(await screen.findByRole("link", { name: "ארכיון" }));
		expect(fetch).toHaveBeenCalledWith(
			"/archive/api?session",
			expect.objectContaining({ cache: "no-store" }),
		);
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "יציאה מהחשבון" }),
			).not.toBeInTheDocument(),
		);
	});
});
