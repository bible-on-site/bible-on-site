import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkProposal } from "~/lib/article-linking/types";

const server = vi.hoisted(() => ({
	generateLinkProposals: vi.fn(),
	listLinkProposals: vi.fn(),
	getLinkPipelineStatus: vi.fn(),
	reviewLinkProposal: vi.fn(),
	applyLinkProposals: vi.fn(),
	search: { articleId: undefined as number | undefined },
}));

vi.mock("~/server/article-link-proposals", () => ({
	generateLinkProposals: server.generateLinkProposals,
	listLinkProposals: server.listLinkProposals,
	getLinkPipelineStatus: server.getLinkPipelineStatus,
	reviewLinkProposal: server.reviewLinkProposal,
	applyLinkProposals: server.applyLinkProposals,
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: Record<string, unknown>) => ({
		...config,
		useSearch: () => ({ articleId: server.search.articleId }),
	}),
	Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { Route } from "~/routes/link-proposals";

const status = {
	schemaReady: true,
	llmEnabled: true,
	articleApiConfigured: true,
	contractVersion: 3,
	supportedKeys: ["coveringSources"],
	pendingKeys: ["moadim"],
};

function proposal(overrides: Partial<LinkProposal> = {}): LinkProposal {
	return {
		id: "prop-1",
		runId: "run-1",
		articleId: 7,
		relationshipKey: "coveringSources",
		action: "add",
		target: { pasukCoordinates: [{ perekId: 18, pasuk: 2 }] },
		targetLabel: "בראשית יח ב",
		evidence: [{ quote: "בראשית יח, ב", spanStart: 5, spanEnd: 19 }],
		rationale: null,
		confidence: null,
		conflict: null,
		status: "approved",
		dedupeKey: "d",
		decisionKey: "e",
		generator: "heuristic-citations:v1",
		model: null,
		promptVersion: "v1",
		baseContentHash: "h",
		baseSnapshot: null,
		promptTokens: null,
		completionTokens: null,
		reviewPatch: null,
		reviewNotes: null,
		reviewer: null,
		reviewedAt: null,
		appliedAt: null,
		appliedSnapshot: null,
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01",
		staleNow: false,
		...overrides,
	};
}

function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

describe("LinkProposalsPage", () => {
	it("keeps SSR generation controls disabled even with a cached capability response", () => {
		const client = new QueryClient();
		client.setQueryData(["link-pipeline-status"], status);
		const { component: Page } = Route as unknown as {
			component: () => React.ReactElement;
		};
		const html = renderToStaticMarkup(
			<QueryClientProvider client={client}>
				<Page />
			</QueryClientProvider>,
		);
		expect(html).toMatch(/<fieldset disabled=""/);
		client.clear();
	});
	beforeEach(() => {
		for (const mock of Object.values(server)) {
			if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
		}
		server.search.articleId = undefined;
		server.getLinkPipelineStatus.mockResolvedValue(status);
		server.listLinkProposals.mockResolvedValue([]);
		server.reviewLinkProposal.mockResolvedValue({
			id: "prop-1",
			status: "approved",
		});
		server.applyLinkProposals.mockResolvedValue({
			outcomes: [{ id: "prop-1", outcome: "applied" }],
		});
		server.generateLinkProposals.mockResolvedValue({
			runId: "run-abcdef01",
			outcomes: [{ articleId: 7, outcome: "generated", proposals: [] }],
		});
	});

	it("validates the articleId search param", () => {
		const { validateSearch } = Route as unknown as {
			validateSearch: (s: Record<string, unknown>) => {
				articleId?: number;
			};
		};
		expect(validateSearch({ articleId: 6 })).toEqual({ articleId: 6 });
		expect(validateSearch({ articleId: "x" })).toEqual({
			articleId: undefined,
		});
		expect(validateSearch({})).toEqual({ articleId: undefined });
	});

	it("renders the capability surface and an empty queue", async () => {
		renderPage();
		expect(await screen.findByText(/חוזה קשרים v3/)).toBeInTheDocument();
		expect(screen.getByText(/LLM זמין/)).toBeInTheDocument();
		expect(screen.getByText(/נתיב כתיבה מוגדר/)).toBeInTheDocument();
		expect(screen.getByText(/ממתין לסכמה: moadim/)).toBeInTheDocument();
		expect(await screen.findByText(/אין הצעות להצגה/)).toBeInTheDocument();
	});

	it("warns when the schema is not deployed", async () => {
		server.getLinkPipelineStatus.mockResolvedValue({
			...status,
			schemaReady: false,
			llmEnabled: false,
			articleApiConfigured: false,
		});
		renderPage();
		expect(await screen.findByText(/סכמת ההצעות לא זמינה/)).toBeInTheDocument();
		expect(screen.getByText(/היוריסטי בלבד/)).toBeInTheDocument();
		expect(screen.getByText(/ARTICLE_API_KEY חסר/)).toBeInTheDocument();
	});

	it("requires at least one article id before generating", async () => {
		renderPage();
		await waitFor(() => expect(screen.getByText("הפק הצעות")).toBeEnabled());
		fireEvent.click(screen.getByText("הפק הצעות"));
		expect(
			await screen.findByText(/יש להזין לפחות מזהה מאמר אחד/),
		).toBeInTheDocument();
		expect(server.generateLinkProposals).not.toHaveBeenCalled();
	});

	it("runs generation with engine, force and dry-run options", async () => {
		renderPage();
		await waitFor(() => expect(screen.getByText("הפק הצעות")).toBeEnabled());
		fireEvent.change(screen.getByPlaceholderText("123, 456"), {
			target: { value: "7, 8, abc, -3" },
		});
		fireEvent.change(screen.getByDisplayValue("היוריסטי (חלץ ציטוטים)"), {
			target: { value: "both" },
		});
		fireEvent.click(screen.getByText("התעלם מ-checkpoint"));
		fireEvent.click(screen.getByText("תצוגה מקדימה בלבד"));
		fireEvent.click(screen.getByText("הפק הצעות"));
		await waitFor(() =>
			expect(server.generateLinkProposals).toHaveBeenCalledWith({
				data: { articleIds: [7, 8], engine: "both", force: true, dryRun: true },
			}),
		);
		expect(await screen.findByText(/הרצה run-abcd/)).toBeInTheDocument();
	});

	it("reports generation errors in the notice", async () => {
		server.generateLinkProposals.mockRejectedValue(new Error("db down"));
		renderPage();
		await waitFor(() => expect(screen.getByText("הפק הצעות")).toBeEnabled());
		fireEvent.change(screen.getByPlaceholderText("123, 456"), {
			target: { value: "7" },
		});
		fireEvent.click(screen.getByText("הפק הצעות"));
		expect(await screen.findByText(/שגיאה בהפקה: db down/)).toBeInTheDocument();
	});

	it("counts per-article errors in the success notice", async () => {
		server.generateLinkProposals.mockResolvedValue({
			runId: "run-12345678",
			outcomes: [
				{ articleId: 7, outcome: "generated", proposals: [] },
				{ articleId: 8, outcome: "error", proposals: [], error: "x" },
			],
		});
		renderPage();
		await waitFor(() => expect(screen.getByText("הפק הצעות")).toBeEnabled());
		fireEvent.change(screen.getByPlaceholderText("123, 456"), {
			target: { value: "7,8" },
		});
		fireEvent.click(screen.getByText("הפק הצעות"));
		expect(await screen.findByText(/1 מאמרים, 1 שגיאות/)).toBeInTheDocument();
	});

	it("filters the queue by status", async () => {
		renderPage();
		await screen.findByText(/אין הצעות להצגה/);
		fireEvent.change(screen.getByDisplayValue("הכל"), {
			target: { value: "held" },
		});
		await waitFor(() =>
			expect(server.listLinkProposals).toHaveBeenCalledWith({
				data: { status: "held", articleId: undefined },
			}),
		);
	});

	it("shows the article search filter chip", async () => {
		server.search.articleId = 7;
		renderPage();
		expect(await screen.findByText(/מסונן למאמר #7/)).toBeInTheDocument();
	});

	it("applies all approved proposals from the queue header", async () => {
		server.listLinkProposals.mockResolvedValue([
			proposal({ id: "a" }),
			proposal({ id: "b", status: "pending" }),
		]);
		renderPage();
		fireEvent.click(await screen.findByText(/החל את כל המאושרות \(1\)/));
		await waitFor(() =>
			expect(server.applyLinkProposals).toHaveBeenCalledWith({
				data: { ids: ["a"] },
			}),
		);
		expect(await screen.findByText(/1 הצעות הוחלו בהצלחה/)).toBeInTheDocument();
	});

	it("reports partial apply failures in the notice", async () => {
		server.listLinkProposals.mockResolvedValue([proposal({ id: "a" })]);
		server.applyLinkProposals.mockResolvedValue({
			outcomes: [{ id: "a", outcome: "conflict", detail: "x" }] as never,
		});
		renderPage();
		fireEvent.click(await screen.findByText(/החל את כל המאושרות \(1\)/));
		expect(await screen.findByText(/0 הוחלו, 1 נכשלו/)).toBeInTheDocument();
	});

	it("forwards card review and apply callbacks to the mutations", async () => {
		server.listLinkProposals.mockResolvedValue([
			proposal({ id: "a", status: "pending" }),
		]);
		renderPage();
		fireEvent.click(await screen.findByText("אשר"));
		await waitFor(() =>
			expect(server.reviewLinkProposal).toHaveBeenCalledWith({
				data: { id: "a", decision: "approve" },
			}),
		);
	});

	it("applies a single approved card via its apply button", async () => {
		server.listLinkProposals.mockResolvedValue([proposal({ id: "a" })]);
		renderPage();
		fireEvent.click(await screen.findByText("החל על המאמר"));
		await waitFor(() =>
			expect(server.applyLinkProposals).toHaveBeenCalledWith({
				data: { ids: ["a"] },
			}),
		);
	});

	it("reports review errors in the notice", async () => {
		server.listLinkProposals.mockResolvedValue([
			proposal({ id: "a", status: "pending" }),
		]);
		server.reviewLinkProposal.mockRejectedValue(new Error("locked"));
		renderPage();
		fireEvent.click(await screen.findByText("אשר"));
		expect(await screen.findByText(/שגיאה בסקירה: locked/)).toBeInTheDocument();
	});

	it("reports apply errors in the notice", async () => {
		server.listLinkProposals.mockResolvedValue([proposal({ id: "a" })]);
		server.applyLinkProposals.mockRejectedValue(new Error("no key"));
		renderPage();
		fireEvent.click(await screen.findByText(/החל את כל המאושרות \(1\)/));
		expect(await screen.findByText(/שגיאה בהחלה: no key/)).toBeInTheDocument();
	});
});
