import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
	getArticle: vi.fn(),
	createArticle: vi.fn(),
	updateArticle: vi.fn(),
	deleteArticle: vi.fn(),
	getAuthors: vi.fn(),
	getPerakim: vi.fn(),
	listMoadim: vi.fn(),
	params: { id: "7" },
	links: [] as Record<string, unknown>[],
	panelProps: [] as Record<string, unknown>[],
}));

vi.mock("~/server/articles", () => ({
	getArticle: server.getArticle,
	createArticle: server.createArticle,
	updateArticle: server.updateArticle,
	deleteArticle: server.deleteArticle,
}));
vi.mock("~/server/authors", () => ({ getAuthors: server.getAuthors }));
vi.mock("~/server/moadim", () => ({ listMoadim: server.listMoadim }));
vi.mock("~/server/perakim", () => ({ getPerakim: server.getPerakim }));
vi.mock("~/components/WysiwygEditor", () => ({
	WysiwygEditor: () => <div data-testid="wysiwyg" />,
}));
vi.mock("~/components/CoveringSourcesEditor", () => ({
	CoveringSourcesEditor: () => <div data-testid="covering-sources" />,
}));
vi.mock("~/components/AutoSaveIndicator", () => ({
	AutoSaveIndicator: () => <div data-testid="autosave" />,
}));
vi.mock("~/components/ArticleRelationshipsPanel", () => ({
	ArticleRelationshipsPanel: (props: Record<string, unknown>) => {
		server.panelProps.push(props);
		return <div data-testid="relationships-panel" />;
	},
}));
vi.mock("~/components/editor/entryLinkSearch", () => ({
	searchEntriesForLink: vi.fn(async () => []),
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: Record<string, unknown>) => ({
		...config,
		useParams: () => ({ id: server.params.id }),
	}),
	useSearch: () => ({ perekId: undefined }),
	useNavigate: () => vi.fn(),
	Link: (props: {
		children?: React.ReactNode;
		to?: string;
		[key: string]: unknown;
	}) => {
		server.links.push(props);
		return <>{props.children}</>;
	},
}));

import { Route } from "~/routes/articles.$id";

const article = {
	id: 7,
	perek_id: 1,
	author_id: 2,
	name: "מאמר בדיקה",
	abstract: "תקציר",
	priority: 3,
	distributable: true,
	content: "<p>תוכן</p>",
	coverage_verified: true,
	coveringSources: [{ perek_id: 1, pasuk: 1 }],
	moedIds: [1],
};

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
}

describe("ArticleEditPage", () => {
	beforeEach(() => {
		server.params.id = "7";
		server.links.length = 0;
		server.panelProps.length = 0;
		for (const mock of Object.values(server)) {
			if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
		}
		server.getArticle.mockResolvedValue(article);
		server.getAuthors.mockResolvedValue([
			{ id: 2, name: "הרב קוק", details: "", imageUrl: "" },
		]);
		server.getPerakim.mockResolvedValue([
			{
				id: 1,
				perek_id: 1,
				sefer_id: 1,
				sefer_name: "בראשית",
				perek: 1,
				perek_in_context: 1,
				additional_letter: null,
				pasuk_count: 31,
			},
		]);
		server.listMoadim.mockResolvedValue([]);
	});

	it("links a persisted article to its link proposals and relationship panel", async () => {
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("relationships-panel")).toBeInTheDocument(),
		);

		// The header link carries the article id into the proposals queue.
		const proposalsLink = server.links.find(
			(link) => link.to === "/link-proposals",
		);
		expect(proposalsLink?.search).toEqual({ articleId: 7 });
		expect(screen.getByText("🔗 הצעות קישור למאמר זה ←")).toBeInTheDocument();

		// The panel receives the live form values for its managed entries.
		await waitFor(() => expect(server.panelProps.length).toBeGreaterThan(0));
		expect(server.panelProps.at(-1)).toMatchObject({
			articleId: 7,
			perekId: 1,
			authorId: 2,
			authorName: "הרב קוק",
			coveringCount: 1,
			coverageVerified: true,
		});
	});

	it("hides the proposals link and panel for a new article", async () => {
		server.params.id = "new";
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("wysiwyg")).toBeInTheDocument(),
		);

		expect(
			screen.queryByText("🔗 הצעות קישור למאמר זה ←"),
		).not.toBeInTheDocument();
		expect(screen.queryByTestId("relationships-panel")).not.toBeInTheDocument();
		expect(server.links.some((link) => link.to === "/link-proposals")).toBe(
			false,
		);
		expect(server.getArticle).not.toHaveBeenCalled();
	});
});
