import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getPerakim, getSefarim, matchedRoute } = vi.hoisted(() => ({
	getPerakim: vi.fn(),
	getSefarim: vi.fn(),
	matchedRoute: { value: null as string | null },
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryFn }: { queryFn: () => unknown }) => ({ data: queryFn() }),
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: unknown) => ({ options }),
	useMatch: ({ from }: { from: string }) =>
		matchedRoute.value === from ? {} : null,
	Outlet: () => <div data-testid="child-route" />,
	Link: ({
		children,
		to,
		params,
		className,
	}: {
		children: ReactNode;
		to: string;
		params?: Record<string, string>;
		className?: string;
	}) => (
		<a
			className={className}
			href={Object.entries(params ?? {}).reduce(
				(path, [key, value]) => path.replace(`$${key}`, value),
				to,
			)}
		>
			{children}
		</a>
	),
}));
vi.mock("~/server/perakim", () => ({ getPerakim }));
vi.mock("~/server/sefarim", () => ({ getSefarim }));

import { Route } from "~/routes/articles";

function Page() {
	const Component = Route.options.component;
	if (!Component) throw new Error("Article route component is missing");
	return <Component />;
}

const roots: Root[] = [];
function serverMarkup() {
	const parsed = new DOMParser().parseFromString(
		renderToString(<Page />),
		"text/html",
	);
	const container = document.createElement("div");
	container.append(
		...Array.from(parsed.body.childNodes, (node) =>
			document.importNode(node, true),
		),
	);
	document.body.append(container);
	return container;
}
async function hydrate(container: HTMLElement) {
	await act(async () => {
		roots.push(hydrateRoot(container, <Page />));
	});
}
function controls(container: HTMLElement = document.body) {
	const queries = within(container);
	return {
		input: queries.getByPlaceholderText("מספר פרק (1-929)"),
		button: queries.getByRole("button", { name: /עבור לפרק/ }),
	};
}
function navigationDestination(action: () => void) {
	const location = { href: "unchanged" };
	vi.stubGlobal(
		"window",
		new Proxy(window, {
			get(target, key) {
				return key === "location" ? location : Reflect.get(target, key, target);
			},
		}),
	);
	try {
		action();
	} finally {
		vi.unstubAllGlobals();
	}
	return location.href;
}

beforeEach(() => {
	getPerakim.mockReset().mockReturnValue([]);
	getSefarim.mockReset().mockReturnValue([]);
	matchedRoute.value = null;
});
afterEach(async () => {
	await act(async () => {
		for (const root of roots.splice(0)) root.unmount();
	});
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

describe("Article chapter navigation", () => {
	it("keeps server controls inactive until their own handlers mount", async () => {
		const container = serverMarkup();
		const { input, button } = controls(container);
		expect(input).toBeDisabled();
		expect(button).toBeDisabled();
		await hydrate(container);
		expect(input).toBeEnabled();
		expect(button).toBeEnabled();
		fireEvent.change(input, { target: { value: "1" } });
		expect(input).toHaveValue(1);
		expect(navigationDestination(() => fireEvent.click(button))).toBe(
			"/articles/perek/1",
		);
	});

	it("keeps another server render inactive after an earlier copy hydrated", async () => {
		await hydrate(serverMarkup());
		const second = serverMarkup();
		expect(controls(second).input).toBeDisabled();
		expect(controls(second).button).toBeDisabled();
		await hydrate(second);
		expect(controls(second).input).toBeEnabled();
	});

	it.each(["/articles/$id", "/articles/perek/$perekId"])(
		"renders a matched child route %s",
		(child) => {
			matchedRoute.value = child;
			render(<Page />);
			expect(screen.getByTestId("child-route")).toBeInTheDocument();
			expect(
				screen.queryByPlaceholderText("מספר פרק (1-929)"),
			).not.toBeInTheDocument();
		},
	);

	it("uses Enter for a valid chapter and ignores unrelated keys", () => {
		render(<Page />);
		const { input } = controls();
		fireEvent.change(input, { target: { value: "929" } });
		expect(
			navigationDestination(() => fireEvent.keyDown(input, { key: "x" })),
		).toBe("unchanged");
		expect(
			navigationDestination(() => fireEvent.keyDown(input, { key: "Enter" })),
		).toBe("/articles/perek/929");
	});

	it.each(["", "0", "930"])("rejects chapter input '%s'", (value) => {
		render(<Page />);
		const { input, button } = controls();
		fireEvent.change(input, { target: { value } });
		expect(navigationDestination(() => fireEvent.click(button))).toBe(
			"unchanged",
		);
	});

	it("groups chapters and preserves Hebrew labels while books expand independently", () => {
		getSefarim.mockReturnValue([
			{ id: 1, name: "בראשית" },
			{ id: 2, name: "שמואל" },
			{ id: 0, name: "לא משויך" },
			{ id: 3, name: "ללא פרקים" },
		]);
		getPerakim.mockReturnValue([
			{
				id: 1,
				perek_id: 1,
				sefer_id: 1,
				perek_in_context: 1,
				perek: 1,
				additional_letter: null,
			},
			{
				id: 2,
				perek_id: 2,
				sefer_id: 1,
				perek_in_context: null,
				perek: 2,
				additional_letter: null,
			},
			{
				id: 3,
				perek_id: 300,
				sefer_id: 2,
				perek_in_context: 3,
				perek: 3,
				additional_letter: "ב",
			},
			{
				id: 4,
				perek_id: 4,
				sefer_id: null,
				perek_in_context: null,
				perek: null,
				additional_letter: null,
			},
		]);
		render(<Page />);
		fireEvent.click(screen.getByRole("button", { name: /^בראשית/ }));
		expect(screen.getByRole("link", { name: "א" })).toHaveAttribute(
			"href",
			"/articles/perek/1",
		);
		expect(screen.getByRole("link", { name: "ב" })).toHaveAttribute(
			"href",
			"/articles/perek/2",
		);
		fireEvent.click(screen.getByRole("button", { name: /^שמואל/ }));
		expect(screen.getByRole("link", { name: "ב ג" })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: /^בראשית/ }));
		expect(screen.queryByRole("link", { name: "א" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "ב ג" })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: /^לא משויך/ }));
		expect(
			document.querySelector('a[href="/articles/perek/4"]'),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /^ללא פרקים/ }));
		expect(
			screen.getByRole("button", { name: /^ללא פרקים/ }),
		).toBeInTheDocument();
	});

	it("keeps the navigation available while chapter data is still pending", () => {
		getPerakim.mockReturnValue(undefined);
		getSefarim.mockReturnValue([{ id: 1, name: "בראשית" }]);
		render(<Page />);
		fireEvent.click(screen.getByRole("button", { name: /^בראשית/ }));
		expect(controls().input).toBeEnabled();
	});

	it("renders the navigation shell while both data queries are pending", () => {
		getPerakim.mockReturnValue(undefined);
		getSefarim.mockReturnValue(undefined);
		render(<Page />);
		expect(controls().input).toBeEnabled();
	});
});
