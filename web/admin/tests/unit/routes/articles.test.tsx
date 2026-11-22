import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getPerakim, matchedRoute } = vi.hoisted(() => ({
	getPerakim: vi.fn(),
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
		...rest
	}: {
		children: ReactNode;
		to: string;
		params?: Record<string, string>;
		className?: string;
		[key: string]: unknown;
	}) => (
		<a
			{...rest}
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
function combobox(container: HTMLElement = document.body) {
	return within(container).getByRole("combobox", {
		name: "חיפוש ספר ופרק",
	});
}
function options() {
	return screen.queryAllByRole("option");
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

const PERAKIM = [
	{
		id: 1,
		perek_id: 1,
		sefer_id: 1,
		sefer_name: "בראשית",
		perek_in_context: 1,
		perek: 1,
		additional_letter: null,
	},
	{
		id: 2,
		perek_id: 2,
		sefer_id: 1,
		sefer_name: "בראשית",
		perek_in_context: null,
		perek: 2,
		additional_letter: null,
	},
	{
		id: 3,
		perek_id: 300,
		sefer_id: 9,
		sefer_name: "מלכים",
		perek_in_context: 1,
		perek: 1,
		additional_letter: "ב",
	},
	{
		id: 4,
		perek_id: 929,
		sefer_id: null,
		sefer_name: null,
		perek_in_context: null,
		perek: null,
		additional_letter: null,
	},
];

beforeEach(() => {
	getPerakim.mockReset().mockReturnValue(PERAKIM);
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
	it("keeps the server-rendered combobox inactive until its handlers mount", async () => {
		const container = serverMarkup();
		expect(combobox(container)).toBeDisabled();
		await hydrate(container);
		expect(combobox(container)).toBeEnabled();
	});

	it("keeps another server render inactive after an earlier copy hydrated", async () => {
		await hydrate(serverMarkup());
		const second = serverMarkup();
		expect(combobox(second)).toBeDisabled();
		await hydrate(second);
		expect(combobox(second)).toBeEnabled();
	});

	it.each(["/articles/$id", "/articles/perek/$perekId"])(
		"renders a matched child route %s",
		(child) => {
			matchedRoute.value = child;
			render(<Page />);
			expect(screen.getByTestId("child-route")).toBeInTheDocument();
			expect(
				screen.queryByRole("combobox", { name: "חיפוש ספר ופרק" }),
			).not.toBeInTheDocument();
		},
	);

	it("lists every perek as a direct link to its articles page", () => {
		render(<Page />);
		expect(
			options().map((option) => option.getAttribute("href")),
		).toEqual([
			"/articles/perek/1",
			"/articles/perek/2",
			"/articles/perek/300",
			"/articles/perek/929",
		]);
		expect(
			screen.getByRole("option", { name: /מלכים\s*פרק ב א/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("option", { name: /אחר\s*פרק/ }),
		).toBeInTheDocument();
	});

	it("filters options by sefer and perek text", () => {
		render(<Page />);
		fireEvent.change(combobox(), { target: { value: "מלכים" } });
		expect(options()).toHaveLength(1);
		fireEvent.change(combobox(), { target: { value: "בראשית ב" } });
		expect(options()).toHaveLength(1);
		expect(
			screen.getByRole("option", { name: /בראשית\s*פרק ב/ }),
		).toBeInTheDocument();
	});

	it("keeps the canonical perek-number jump through a digit query", () => {
		render(<Page />);
		fireEvent.change(combobox(), { target: { value: "300" } });
		expect(options()).toHaveLength(1);
		expect(
			navigationDestination(() =>
				fireEvent.keyDown(combobox(), { key: "Enter" }),
			),
		).toBe("/articles/perek/300");
	});

	it("uses Enter for the first match and ignores unrelated keys", () => {
		render(<Page />);
		fireEvent.change(combobox(), { target: { value: "מלכים" } });
		expect(
			navigationDestination(() =>
				fireEvent.keyDown(combobox(), { key: "x" }),
			),
		).toBe("unchanged");
		expect(
			navigationDestination(() =>
				fireEvent.keyDown(combobox(), { key: "Enter" }),
			),
		).toBe("/articles/perek/300");
	});

	it("clears the query on Escape", () => {
		render(<Page />);
		fireEvent.change(combobox(), { target: { value: "מלכים" } });
		fireEvent.keyDown(combobox(), { key: "Escape" });
		expect(combobox()).toHaveValue("");
		expect(options()).toHaveLength(4);
	});

	it("reports no matching perakim", () => {
		render(<Page />);
		fireEvent.change(combobox(), { target: { value: "לא קיים" } });
		expect(options()).toHaveLength(0);
		expect(screen.getByText("אין פרקים תואמים")).toBeInTheDocument();
		expect(
			navigationDestination(() =>
				fireEvent.keyDown(combobox(), { key: "Enter" }),
			),
		).toBe("unchanged");
	});

	it("caps the empty-query list and shows the running count", () => {
		getPerakim.mockReturnValue(
			Array.from({ length: 80 }, (_, i) => ({
				id: i + 1,
				perek_id: i + 1,
				sefer_id: 1,
				sefer_name: "בראשית",
				perek_in_context: i + 1,
				perek: i + 1,
				additional_letter: null,
			})),
		);
		render(<Page />);
		expect(options()).toHaveLength(60);
		expect(screen.getByText("60 מתוך 80 פרקים")).toBeInTheDocument();
	});

	it("keeps the combobox available while chapter data is still pending", () => {
		getPerakim.mockReturnValue(undefined);
		render(<Page />);
		expect(combobox()).toBeEnabled();
		expect(screen.getByText("אין פרקים תואמים")).toBeInTheDocument();
	});
});
