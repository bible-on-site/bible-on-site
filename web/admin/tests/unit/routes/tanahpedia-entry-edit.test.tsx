import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RevisionConflictError } from "~/lib/tanahpedia/revisions-shared";

const {
	getEntryMock,
	getLlmAssistantStatusMock,
	createEntryMock,
	updateEntryMock,
	deleteEntryMock,
	paramsMock,
	navigateMock,
} = vi.hoisted(() => ({
	getEntryMock: vi.fn(),
	getLlmAssistantStatusMock: vi.fn(),
	createEntryMock: vi.fn(),
	updateEntryMock: vi.fn(),
	deleteEntryMock: vi.fn(),
	paramsMock: vi.fn(() => ({ id: "entry-1" })),
	navigateMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: { component: unknown }) => ({
		...config,
		useParams: paramsMock,
	}),
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="/">{children}</a>
	),
	useNavigate: () => navigateMock,
}));

vi.mock("~/server/tanahpedia/entries", () => ({
	getEntry: getEntryMock,
	createEntry: createEntryMock,
	updateEntry: updateEntryMock,
	deleteEntry: deleteEntryMock,
}));

vi.mock("~/server/tanahpedia/llm-assistant", () => ({
	getLlmAssistantStatus: getLlmAssistantStatusMock,
}));

vi.mock("~/components/WysiwygEditor", () => ({
	WysiwygEditor: ({ onChange }: { onChange: (html: string) => void }) => (
		<button
			data-testid="wysiwyg-editor"
			type="button"
			onClick={() => onChange("<p>תוכן חדש</p>")}
		>
			editor
		</button>
	),
}));

vi.mock("~/components/tanahpedia/EntryStructuralPanel", () => ({
	EntryStructuralPanel: () => <div data-testid="structural-panel" />,
}));

vi.mock("~/components/tanahpedia/EntryHistoryPanel", () => ({
	EntryHistoryPanel: ({ onEntryChanged }: { onEntryChanged: () => void }) => (
		<button data-testid="history-panel" type="button" onClick={onEntryChanged}>
			history
		</button>
	),
}));

vi.mock("~/components/tanahpedia/TanahpediaLlmAssistantPanel", () => ({
	TanahpediaLlmAssistantPanel: ({
		onApplyEntryFields,
	}: {
		onApplyEntryFields: (patch: { title: string; unique_name: string }) => void;
	}) => (
		<div data-testid="llm-panel">
			<button
				type="button"
				onClick={() =>
					onApplyEntryFields({
						title: "כותרת מוצעת",
						unique_name: "שם-מוצע",
					})
				}
			>
				החל הצעה
			</button>
		</div>
	),
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
	return client;
}

const existingEntry = {
	id: "entry-1",
	unique_name: "משה-רבנו",
	title: "משה רבנו",
	content: "<p>גוף</p>",
	currentRevisionId: "rev-1",
};

describe("EntryEditPage", () => {
	beforeEach(() => {
		paramsMock.mockReset().mockReturnValue({ id: "entry-1" });
		navigateMock.mockReset();
		getEntryMock.mockReset().mockResolvedValue(existingEntry);
		getLlmAssistantStatusMock.mockReset().mockResolvedValue({
			enabled: false,
		});
		createEntryMock.mockReset();
		updateEntryMock.mockReset();
		deleteEntryMock.mockReset();
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

		it("updates both metadata fields from user input", async () => {
			renderPage();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));

			fireEvent.change(screen.getByLabelText(/כותרת/), {
				target: { value: "כותרת חדשה" },
			});
			fireEvent.change(screen.getByLabelText("שם ייחודי (URL)"), {
				target: { value: "שם-חדש" },
			});

			expect(screen.getByLabelText(/כותרת/)).toHaveValue("כותרת חדשה");
			expect(screen.getByLabelText("שם ייחודי (URL)")).toHaveValue("שם-חדש");
		});

		it("hides the history tab for a new entry", async () => {
			paramsMock.mockReturnValue({ id: "new" });
			renderPage();

			await screen.findByRole("tab", { name: "תוכן" });
			expect(
				screen.queryByRole("tab", { name: "היסטוריה" }),
			).not.toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: "מחק ערך" }),
			).not.toBeInTheDocument();
		});

		it("loads the entry into the history panel on its tab", async () => {
			renderPage();
			fireEvent.click(await screen.findByRole("tab", { name: "היסטוריה" }));

			expect(await screen.findByTestId("history-panel")).toBeInTheDocument();
		});

		it("invalidates the entry query when the history panel reports a change", async () => {
			const client = renderPage();
			const invalidateSpy = vi.spyOn(client, "invalidateQueries");
			fireEvent.click(await screen.findByRole("tab", { name: "היסטוריה" }));
			fireEvent.click(await screen.findByTestId("history-panel"));

			expect(invalidateSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					queryKey: ["tanahpedia-entry", "entry-1"],
				}),
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

		it("applies proposed entry fields to the metadata form", async () => {
			getLlmAssistantStatusMock.mockResolvedValue({ enabled: true });
			renderPage();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			fireEvent.click(await screen.findByRole("button", { name: "החל הצעה" }));

			expect(screen.getByLabelText(/כותרת/)).toHaveValue("כותרת מוצעת");
			expect(screen.getByLabelText("שם ייחודי (URL)")).toHaveValue("שם-מוצע");
		});
	});

	describe("saving", () => {
		it("updates an existing entry through the save button", async () => {
			updateEntryMock.mockResolvedValue({
				id: "entry-1",
				headRevisionId: "rev-2",
			});
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			await waitFor(() =>
				expect(updateEntryMock).toHaveBeenCalledWith({
					data: expect.objectContaining({
						id: "entry-1",
						unique_name: "משה-רבנו",
						title: "משה רבנו",
						baseRevisionId: "rev-1",
					}),
				}),
			);
		});

		it("creates a new entry and navigates to its edit page", async () => {
			paramsMock.mockReturnValue({ id: "new" });
			createEntryMock.mockResolvedValue({
				id: "entry-new",
				headRevisionId: "rev-1",
			});
			renderPage();

			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			fireEvent.change(screen.getByPlaceholderText("כותרת הערך"), {
				target: { value: "ערך חדש" },
			});
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			await waitFor(() =>
				expect(createEntryMock).toHaveBeenCalledWith({
					data: expect.objectContaining({
						title: "ערך חדש",
						source: "admin",
					}),
				}),
			);
			expect(updateEntryMock).not.toHaveBeenCalled();
			await waitFor(() =>
				expect(navigateMock).toHaveBeenCalledWith(
					expect.objectContaining({ params: { id: "entry-new" } }),
				),
			);
		});

		it("edits content through the wysiwyg and autosaves it", async () => {
			updateEntryMock.mockResolvedValue({
				id: "entry-1",
				headRevisionId: "rev-2",
			});
			renderPage();
			await screen.findByTestId("wysiwyg-editor");

			fireEvent.click(screen.getByTestId("wysiwyg-editor"));

			expect(
				await screen.findByText("יש שינויים שלא נשמרו"),
			).toBeInTheDocument();
			await waitFor(
				() =>
					expect(updateEntryMock).toHaveBeenCalledWith({
						data: expect.objectContaining({
							id: "entry-1",
							content: "<p>תוכן חדש</p>",
						}),
					}),
				{ timeout: 4000 },
			);
		});

		it("surfaces a revision conflict when the server rejects the save", async () => {
			updateEntryMock.mockRejectedValue(
				new RevisionConflictError("stale base"),
			);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			expect(
				await screen.findByRole("button", { name: "טען מחדש" }),
			).toBeInTheDocument();
		});

		it("reloads the entry from the conflict banner", async () => {
			updateEntryMock.mockRejectedValue(
				new RevisionConflictError("stale base"),
			);
			const client = renderPage();
			const invalidateSpy = vi.spyOn(client, "invalidateQueries");
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			fireEvent.click(await screen.findByRole("button", { name: "טען מחדש" }));

			expect(invalidateSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					queryKey: ["tanahpedia-entry", "entry-1"],
				}),
			);
		});

		it("initializes an entry without content or a head revision", async () => {
			getEntryMock.mockResolvedValue({
				...existingEntry,
				content: null,
				currentRevisionId: null,
			});
			updateEntryMock.mockResolvedValue({
				id: "entry-1",
				headRevisionId: "rev-2",
			});
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			await waitFor(() =>
				expect(updateEntryMock).toHaveBeenCalledWith({
					data: expect.objectContaining({
						baseRevisionId: null,
						content: "",
					}),
				}),
			);
		});

		it("invalidates the revision list under the route id when the save response lacks an entry", async () => {
			updateEntryMock.mockResolvedValue(undefined);
			const client = renderPage();
			const invalidateSpy = vi.spyOn(client, "invalidateQueries");
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			await waitFor(() =>
				expect(invalidateSpy).toHaveBeenCalledWith(
					expect.objectContaining({
						queryKey: ["tanahpedia-entry-revisions", "entry-1"],
					}),
				),
			);
		});

		it("does not raise the conflict banner for a generic save failure", async () => {
			updateEntryMock.mockRejectedValue(new Error("db down"));
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			await waitFor(() => expect(updateEntryMock).toHaveBeenCalled());
			// flush the rejection through the mutation lifecycle (onError → state)
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			expect(
				screen.queryByRole("button", { name: "טען מחדש" }),
			).not.toBeInTheDocument();
		});

		it("skips the autosave when an existing entry's title is cleared", async () => {
			renderPage();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			vi.useFakeTimers({ toFake: ["setTimeout"] });
			try {
				fireEvent.change(screen.getByLabelText(/כותרת/), {
					target: { value: "" },
				});

				expect(screen.getByText("יש שינויים שלא נשמרו")).toBeInTheDocument();
				await act(async () => {
					await vi.advanceTimersByTimeAsync(2000);
				});
				expect(updateEntryMock).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it("renders an empty title and falls back to the draft content when the entry query has no entry", async () => {
			getEntryMock.mockRejectedValue(new Error("entry query failed"));
			renderPage();

			expect(await screen.findByText("עריכת ערך:")).toBeInTheDocument();

			fireEvent.click(screen.getByRole("tab", { name: "היסטוריה" }));
			expect(await screen.findByTestId("history-panel")).toBeInTheDocument();
		});

		it("shows the pending label while a save is in flight", async () => {
			updateEntryMock.mockReturnValue(new Promise(() => undefined));
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			expect(
				await screen.findByRole("button", { name: "שומר..." }),
			).toBeDisabled();
		});
	});

	describe("deleting", () => {
		it("deletes the entry after confirmation and goes back to the list", async () => {
			const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
			deleteEntryMock.mockResolvedValue({ success: true });
			renderPage();
			fireEvent.click(await screen.findByRole("button", { name: "מחק ערך" }));

			await waitFor(() =>
				expect(deleteEntryMock).toHaveBeenCalledWith({ data: "entry-1" }),
			);
			await waitFor(() =>
				expect(navigateMock).toHaveBeenCalledWith(
					expect.objectContaining({ to: "/tanahpedia" }),
				),
			);
			confirmSpy.mockRestore();
		});

		it("does nothing when the confirmation is cancelled", async () => {
			const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
			renderPage();
			fireEvent.click(await screen.findByRole("button", { name: "מחק ערך" }));

			expect(deleteEntryMock).not.toHaveBeenCalled();
			confirmSpy.mockRestore();
		});
	});
});
