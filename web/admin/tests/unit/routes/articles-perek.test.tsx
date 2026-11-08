import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { deleteArticle, getArticlesByPerek, getPerek, routeParams } = vi.hoisted(
	() => ({
		deleteArticle: vi.fn(),
		getArticlesByPerek: vi.fn(),
		getPerek: vi.fn(),
		routeParams: { perekId: "2" },
	}),
);

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: unknown) => ({
		options,
		useParams: () => routeParams,
	}),
	Link: ({
		children,
		to,
		params,
		search,
		className,
	}: {
		children: ReactNode;
		to: string;
		params?: Record<string, string>;
		search?: Record<string, unknown>;
		className?: string;
	}) => {
		const pathname = Object.entries(params ?? {}).reduce(
			(value, [key, replacement]) => value.replace(`$${key}`, replacement),
			to,
		);
		const query = new URLSearchParams(
			Object.entries(search ?? {}).map(([key, value]) => [key, String(value)]),
		).toString();
		return (
			<a className={className} href={query ? `${pathname}?${query}` : pathname}>
				{children}
			</a>
		);
	},
}));
vi.mock("~/server/articles", () => ({ deleteArticle, getArticlesByPerek }));
vi.mock("~/server/perakim", () => ({ getPerek }));

import { Route } from "~/routes/articles.perek.$perekId";
import type { Article } from "~/server/articles";

const clients: QueryClient[] = [];
function Page() {
	const Component = Route.options.component;
	if (!Component) throw new Error("Chapter article route component is missing");
	return <Component />;
}
function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	return {
		client,
		...render(
			<QueryClientProvider client={client}>
				<Page />
			</QueryClientProvider>,
		),
	};
}
type RuntimeArticle = Omit<Article, "coverage_verified"> & {
	coverage_verified: boolean | number;
};
function article(overrides: Partial<RuntimeArticle> = {}): RuntimeArticle {
	return {
		id: 17,
		perek_id: 2,
		author_id: 3,
		name: "מאמר בדיקה",
		abstract: null,
		priority: 1,
		distributable: false,
		author_name: "מחבר",
		coverage_verified: 0,
		...overrides,
	};
}

beforeEach(() => {
	routeParams.perekId = "2";
	getPerek.mockReset().mockResolvedValue({ perek: 2, sefer_name: "בראשית" });
	getArticlesByPerek.mockReset().mockResolvedValue([article()]);
	deleteArticle.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	vi.restoreAllMocks();
});

describe("Chapter article list", () => {
	it.each([0, false])(
		"does not render a zero or badge for unverified MySQL value %s",
		async (coverage_verified) => {
			getArticlesByPerek.mockResolvedValue([article({ coverage_verified })]);
			renderPage();
			await screen.findByRole("link", { name: "מאמר בדיקה" });
			expect(screen.queryByText("0", { exact: true })).not.toBeInTheDocument();
			expect(screen.queryByText(/כיסוי פסוקים מאומת/)).not.toBeInTheDocument();
		},
	);

	it.each([1, true])(
		"renders the verified badge and count for MySQL value %s",
		async (coverage_verified) => {
			getArticlesByPerek.mockResolvedValue([
				article({ coverage_verified, covering_count: 2 }),
			]);
			renderPage();
			expect(
				await screen.findByText("כיסוי פסוקים מאומת (2 פסוקים)"),
			).toBeVisible();
			expect(screen.queryByText("0", { exact: true })).not.toBeInTheDocument();
		},
	);

	it("keeps the loading state until the article query resolves", async () => {
		let finish: (value: RuntimeArticle[]) => void = () => {
			throw new Error("Query has not started");
		};
		getArticlesByPerek.mockReturnValue(
			new Promise<RuntimeArticle[]>((resolve) => {
				finish = resolve;
			}),
		);
		const { container } = renderPage();
		expect(container.querySelector(".animate-spin")).toBeInTheDocument();
		expect(screen.queryByRole("heading")).not.toBeInTheDocument();
		await act(async () => {
			finish([]);
		});
		expect(await screen.findByText("אין מאמרים בפרק זה עדיין")).toBeVisible();
		expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
	});

	it("shows the legacy verified badge when no covering count is supplied", async () => {
		getArticlesByPerek.mockResolvedValue([
			article({ coverage_verified: true }),
		]);
		renderPage();
		expect(
			await screen.findByText("כיסוי פסוקים מאומת", { exact: true }),
		).toBeVisible();
		expect(screen.queryByText(/\(\d+ פסוקים\)/)).not.toBeInTheDocument();
	});

	it("offers chapter-specific creation when the list is empty and falls back to the URL chapter", async () => {
		getPerek.mockResolvedValue({ perek: null, sefer_name: "" });
		getArticlesByPerek.mockResolvedValue([]);
		renderPage();
		expect(
			await screen.findByRole("heading", { name: "📖 פרק 2" }),
		).toBeVisible();
		expect(screen.getByText("אין מאמרים בפרק זה עדיין")).toBeVisible();
		expect(screen.queryByText(/^ספר /)).not.toBeInTheDocument();
		for (const name of [/מאמר חדש לפרק זה$/, /הוסף מאמר חדש$/]) {
			expect(screen.getByRole("link", { name })).toHaveAttribute(
				"href",
				"/articles/new?perekId=2",
			);
		}
		expect(getPerek).toHaveBeenCalledWith({ data: 2 });
		expect(getArticlesByPerek).toHaveBeenCalledWith({ data: 2 });
	});

	it("does not query the server for a malformed chapter URL", () => {
		routeParams.perekId = "invalid";
		renderPage();
		expect(
			screen.getByRole("heading", { name: "📖 פרק invalid" }),
		).toBeVisible();
		expect(screen.getByText("מאמרים בפרק זה (0 מאמרים)")).toBeVisible();
		expect(getPerek).not.toHaveBeenCalled();
		expect(getArticlesByPerek).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("link", { name: /^פרק / }),
		).not.toBeInTheDocument();
	});

	it.each([
		{ chapter: "1", previous: undefined, next: "2" },
		{ chapter: "929", previous: "928", next: undefined },
	])(
		"bounds chapter navigation at $chapter",
		async ({ chapter, previous, next }) => {
			routeParams.perekId = chapter;
			getPerek.mockResolvedValue({
				perek: Number(chapter),
				sefer_name: "בראשית",
			});
			renderPage();
			await screen.findByRole("link", { name: "מאמר בדיקה" });
			const links = screen
				.getAllByRole("link")
				.filter((link) =>
					link.getAttribute("href")?.startsWith("/articles/perek/"),
				);
			expect(links.map((link) => link.getAttribute("href"))).toEqual(
				[previous, next]
					.filter((value) => value !== undefined)
					.map((value) => `/articles/perek/${value}`),
			);
		},
	);

	it("keeps the article link usable when its title and author are absent", async () => {
		getArticlesByPerek.mockResolvedValue([
			article({ name: "", author_name: undefined }),
		]);
		renderPage();
		expect(
			await screen.findByRole("link", { name: "(ללא כותרת)" }),
		).toHaveAttribute("href", "/articles/17");
		expect(screen.queryByText(/מאת:/)).not.toBeInTheDocument();
	});

	it("keeps the article when its deletion is cancelled", async () => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
		renderPage();
		fireEvent.click(await screen.findByRole("button", { name: /מחיקה$/ }));
		expect(confirm).toHaveBeenCalledWith('האם למחוק את המאמר "מאמר בדיקה"?');
		expect(deleteArticle).not.toHaveBeenCalled();
		expect(screen.getByRole("link", { name: "מאמר בדיקה" })).toBeVisible();
	});

	it("disables deletion while pending and refreshes the chapter list after success", async () => {
		vi.spyOn(window, "confirm").mockReturnValue(true);
		let finish: () => void = () => {
			throw new Error("Deletion has not started");
		};
		deleteArticle.mockReturnValue(
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
		);
		getArticlesByPerek.mockResolvedValueOnce([article()]).mockResolvedValue([]);
		const { client } = renderPage();
		const invalidate = vi.spyOn(client, "invalidateQueries");
		const button = await screen.findByRole("button", { name: /מחיקה$/ });
		fireEvent.click(button);
		await waitFor(() => {
			expect(deleteArticle).toHaveBeenCalledWith({ data: 17 });
			expect(button).toBeDisabled();
		});
		await act(async () => {
			finish();
		});
		expect(await screen.findByText("אין מאמרים בפרק זה עדיין")).toBeVisible();
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ["articles", "perek", 2],
		});
	});
});
