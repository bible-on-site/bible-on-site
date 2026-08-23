import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEntryMock, getLlmAssistantStatusMock } = vi.hoisted(() => ({
	getEntryMock: vi.fn(),
	getLlmAssistantStatusMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: { component: unknown }) => ({
		...config,
		useParams: () => ({ id: "entry-1" }),
	}),
	Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
	useNavigate: () => vi.fn(),
}));

vi.mock("~/server/tanahpedia/entries", () => ({
	getEntry: getEntryMock,
	createEntry: vi.fn(),
	updateEntry: vi.fn(),
	deleteEntry: vi.fn(),
}));

vi.mock("~/server/tanahpedia/llm-assistant", () => ({
	getLlmAssistantStatus: getLlmAssistantStatusMock,
}));

vi.mock("~/components/WysiwygEditor", () => ({
	WysiwygEditor: () => <div data-testid="wysiwyg-editor" />,
}));

vi.mock("~/components/tanahpedia/EntryStructuralPanel", () => ({
	EntryStructuralPanel: () => <div data-testid="structural-panel" />,
}));

vi.mock("~/components/tanahpedia/TanahpediaLlmAssistantPanel", () => ({
	TanahpediaLlmAssistantPanel: () => <div data-testid="llm-panel" />,
}));

vi.mock("~/components/editor/entryLinkSearch", () => ({
	searchEntriesForLink: vi.fn(),
}));

import { Route } from "~/routes/tanahpedia.entries.$id";

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

describe("EntryEditPage", () => {
	beforeEach(() => {
		getEntryMock.mockReset().mockResolvedValue({
			id: "entry-1",
			unique_name: "משה-רבנו",
			title: "משה רבנו",
			content: "<p>גוף</p>",
		});
		getLlmAssistantStatusMock.mockReset().mockResolvedValue({ enabled: false });
	});

	describe("tabs", () => {
		it("opens on the content tab showing the editor", async () => {
			renderPage();
			expect(await screen.findByTestId("wysiwyg-editor")).toBeInTheDocument();
			expect(screen.queryByLabelText(/כותרת/)).not.toBeInTheDocument();
		});

		it("shows the metadata fields only on the metadata tab", async () => {
			renderPage();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));

			expect(screen.getByPlaceholderText("כותרת הערך")).toBeInTheDocument();
			expect(screen.getByPlaceholderText("שם-ייחודי-בurl")).toBeInTheDocument();
			expect(screen.queryByTestId("wysiwyg-editor")).not.toBeInTheDocument();
		});

		it("keeps the structural panel with the metadata", async () => {
			renderPage();
			expect(screen.queryByTestId("structural-panel")).not.toBeInTheDocument();

			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			expect(screen.getByTestId("structural-panel")).toBeInTheDocument();
		});

		it("marks the active tab for assistive technology", async () => {
			renderPage();
			const contentTab = await screen.findByRole("tab", { name: "תוכן" });
			expect(contentTab).toHaveAttribute("aria-selected", "true");

			fireEvent.click(screen.getByRole("tab", { name: "מטא-דאטה" }));
			expect(screen.getByRole("tab", { name: "מטא-דאטה" })).toHaveAttribute(
				"aria-selected",
				"true",
			);
		});
	});

	describe("llm assistant", () => {
		it("stays hidden while the assistant is not configured", async () => {
			renderPage();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));

			await waitFor(() => expect(getLlmAssistantStatusMock).toHaveBeenCalled());
			expect(screen.queryByTestId("llm-panel")).not.toBeInTheDocument();
		});

		it("appears once the server reports it enabled", async () => {
			getLlmAssistantStatusMock.mockResolvedValue({ enabled: true });
			renderPage();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));

			expect(await screen.findByTestId("llm-panel")).toBeInTheDocument();
		});
	});
});
