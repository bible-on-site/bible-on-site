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
	getEditorIdentityMock,
	paramsMock,
	navigateMock,
	aliasMocks,
} = vi.hoisted(() => ({
	getEntryMock: vi.fn(),
	getLlmAssistantStatusMock: vi.fn(),
	createEntryMock: vi.fn(),
	updateEntryMock: vi.fn(),
	deleteEntryMock: vi.fn(),
	getEditorIdentityMock: vi.fn(),
	paramsMock: vi.fn(() => ({ id: "entry-1" })),
	navigateMock: vi.fn(),
	aliasMocks: {
		getEntryAliases: vi.fn(),
		checkPediaName: vi.fn(),
		saveEntryAlias: vi.fn(),
		removeEntryFromAlias: vi.fn(),
		deleteAliasName: vi.fn(),
	},
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

vi.mock("~/server/tanahpedia/aliases", () => ({
	getEntryAliases: aliasMocks.getEntryAliases,
	checkPediaName: aliasMocks.checkPediaName,
	saveEntryAlias: aliasMocks.saveEntryAlias,
	removeEntryFromAlias: aliasMocks.removeEntryFromAlias,
	deleteAliasName: aliasMocks.deleteAliasName,
}));

vi.mock("~/server/session", () => ({
	getEditorIdentity: getEditorIdentityMock,
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

const ACCOUNT = "acct-1";
const DRAFT_KEY = `tanahpedia-draft:v2:${ACCOUNT}:entry:entry-1`;

// The DOM externs declare a narrower StorageEvent constructor than the
// runtime one; a plain Event carrying the properties is enough.
const storageEvent = (key: string | null, newValue: string | null = null) =>
	Object.assign(new Event("storage"), { key, newValue });

const storedDraft = (
	over: Record<string, unknown> = {},
): Record<string, unknown> => ({
	version: 2,
	accountId: ACCOUNT,
	scope: "entry:entry-1",
	sessionId: "other-tab",
	baseRevisionId: "rev-1",
	savedAt: new Date().toISOString(),
	form: {
		unique_name: "טיוטה",
		title: "טיוטה מקומית",
		content: "<p>טיוטה</p>",
	},
	source: "admin",
	notes: null,
	...over,
});

describe("EntryEditPage", () => {
	beforeEach(() => {
		localStorage.clear();
		paramsMock.mockReset().mockReturnValue({ id: "entry-1" });
		navigateMock.mockReset();
		getEntryMock.mockReset().mockResolvedValue(existingEntry);
		getLlmAssistantStatusMock.mockReset().mockResolvedValue({
			enabled: false,
		});
		getEditorIdentityMock.mockReset().mockResolvedValue({ id: ACCOUNT });
		createEntryMock.mockReset();
		updateEntryMock.mockReset();
		deleteEntryMock.mockReset();
		aliasMocks.getEntryAliases.mockReset().mockResolvedValue([]);
		aliasMocks.checkPediaName
			.mockReset()
			.mockImplementation(async ({ data }: { data: { name: string } }) => ({
				kind: "free",
				name: data.name,
			}));
		aliasMocks.saveEntryAlias.mockReset();
		aliasMocks.removeEntryFromAlias.mockReset();
		aliasMocks.deleteAliasName.mockReset();
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
			expect(screen.getByPlaceholderText("למשל: משה-רבנו")).toBeInTheDocument();
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
			fireEvent.change(screen.getByLabelText(/שם ייחודי/), {
				target: { value: "שם-חדש" },
			});

			expect(screen.getByLabelText(/כותרת/)).toHaveValue("כותרת חדשה");
			expect(screen.getByLabelText(/שם ייחודי/)).toHaveValue("שם-חדש");
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
			await act(async () => {
				fireEvent.click(await screen.findByTestId("history-panel"));
			});

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
			expect(screen.getByLabelText(/שם ייחודי/)).toHaveValue("שם-מוצע");
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

		it("mirrors edits into the local draft only — never the server (#2612)", async () => {
			renderPage();
			await screen.findByTestId("wysiwyg-editor");

			fireEvent.click(screen.getByTestId("wysiwyg-editor"));

			expect(
				await screen.findByText("יש שינויים שלא נשמרו בשרת"),
			).toBeInTheDocument();
			// The draft mirrors the edit without any server traffic.
			await waitFor(() => {
				const raw = localStorage.getItem(DRAFT_KEY);
				expect(raw).toBeTruthy();
				expect(JSON.parse(raw as string).form.content).toBe("<p>תוכן חדש</p>");
			});
			expect(updateEntryMock).not.toHaveBeenCalled();
			expect(createEntryMock).not.toHaveBeenCalled();
			// Prolonged editing still creates zero server writes.
			await act(async () => {
				await new Promise((r) => setTimeout(r, 2500));
			});
			expect(updateEntryMock).not.toHaveBeenCalled();
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

			await act(async () => {
				fireEvent.click(
					await screen.findByRole("button", { name: "טען מחדש" }),
				);
			});

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

		it("blocks committing while the title is cleared but still mirrors the draft", async () => {
			renderPage();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			fireEvent.change(screen.getByLabelText(/כותרת/), {
				target: { value: "" },
			});

			expect(screen.getByText("יש שינויים שלא נשמרו בשרת")).toBeInTheDocument();
			expect(screen.getByRole("button", { name: "שמור עכשיו" })).toBeDisabled();
			// An empty title is still protected locally — the draft holds work
			// even when it cannot be committed.
			await waitFor(() => {
				const raw = localStorage.getItem(DRAFT_KEY);
				expect(raw).toBeTruthy();
				expect(JSON.parse(raw as string).form.title).toBe("");
			});
			expect(updateEntryMock).not.toHaveBeenCalled();
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

	describe("main-address rename (#2613)", () => {
		it("announces the old URL was kept as an alias and lets it be dismissed", async () => {
			updateEntryMock.mockResolvedValue({
				id: "entry-1",
				headRevisionId: "rev-2",
				unique_name: "משה-הנביא",
				renamedFrom: "משה-רבנו",
				oldNameAliasCreated: true,
			});
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			expect(
				await screen.findByText(/«משה-רבנו» נשמרה כשם חלופי/),
			).toBeInTheDocument();

			fireEvent.click(screen.getByRole("button", { name: "הבנתי" }));
			expect(
				screen.queryByText(/«משה-רבנו» נשמרה כשם חלופי/),
			).not.toBeInTheDocument();
		});

		it("explains when the old URL keeps leading to the other entries", async () => {
			updateEntryMock.mockResolvedValue({
				headRevisionId: "rev-2",
				unique_name: "משה-הנביא",
				renamedFrom: "משה-רבנו",
				oldNameAliasCreated: false,
			});
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			expect(
				await screen.findByText(/«משה-רבנו» משותפת עם ערכים אחרים/),
			).toBeInTheDocument();
		});

		it("reports the dropped old URL when the admin opted out of the alias", async () => {
			updateEntryMock.mockResolvedValue({
				id: "entry-1",
				headRevisionId: "rev-2",
				unique_name: "משה-הנביא",
				renamedFrom: "משה-רבנו",
				oldNameAliasCreated: false,
			});
			renderPage();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			await waitFor(() =>
				expect(screen.getByLabelText(/שם ייחודי/)).toHaveValue("משה-רבנו"),
			);
			fireEvent.change(screen.getByLabelText(/שם ייחודי/), {
				target: { value: "משה-הנביא" },
			});
			fireEvent.click(await screen.findByRole("checkbox"));

			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			await waitFor(() =>
				expect(updateEntryMock).toHaveBeenCalledWith({
					data: expect.objectContaining({
						keepOldNameAsAlias: false,
					}),
				}),
			);
			expect(
				await screen.findByText(/«משה-רבנו» אינה מובילה עוד לערך זה/),
			).toBeInTheDocument();
		});

		it("hides the rename notice once a later save fails", async () => {
			updateEntryMock
				.mockResolvedValueOnce({
					id: "entry-1",
					headRevisionId: "rev-2",
					unique_name: "משה-הנביא",
					renamedFrom: "משה-רבנו",
					oldNameAliasCreated: true,
				})
				.mockRejectedValueOnce(new Error("db down"));
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			expect(
				await screen.findByText(/«משה-רבנו» נשמרה כשם חלופי/),
			).toBeInTheDocument();

			fireEvent.click(screen.getByTestId("wysiwyg-editor"));
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			expect(
				await screen.findByText(/אפשר לנסות שוב עכשיו/),
			).toBeInTheDocument();
			expect(
				screen.queryByText(/«משה-רבנו» נשמרה כשם חלופי/),
			).not.toBeInTheDocument();
		});

		it("renders the aliases section when the entry itself is missing", async () => {
			getEntryMock.mockResolvedValue(null);
			renderPage();

			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));

			expect(
				await screen.findByText("אין כתובות נוספות לערך זה עדיין."),
			).toBeInTheDocument();
		});
	});

	// Issue #2611 regression: a persistent non-conflict save failure used to
	// be swallowed silently while autosave retried every ~2s forever, with no
	// UI indication and no recovery path.
	describe("save failure handling (#2611)", () => {
		it("surfaces a generic save failure with a retry action", async () => {
			updateEntryMock.mockRejectedValue(new Error("db down"));
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			expect(
				await screen.findByRole("button", { name: "נסה שוב" }),
			).toBeInTheDocument();
			expect(await screen.findByText("השמירה לשרת נכשלה")).toBeInTheDocument();
			// The unsaved edits stay dirty — nothing pretends the save worked.
			expect(screen.queryByText(/נשמר בשרת/)).not.toBeInTheDocument();
		});

		it("does not auto-commit further edits after a failure (#2612)", async () => {
			updateEntryMock.mockRejectedValue(new Error("db down"));
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			await screen.findByRole("button", { name: "נסה שוב" });
			expect(updateEntryMock).toHaveBeenCalledTimes(1);

			// Editing after the failure mirrors to the draft only — the
			// explicit retry is the only path back to the server.
			fireEvent.click(screen.getByTestId("wysiwyg-editor"));
			await act(async () => {
				await new Promise((r) => setTimeout(r, 2500));
			});
			expect(updateEntryMock).toHaveBeenCalledTimes(1);
		});

		it("retries with the current editor snapshot and clears on success", async () => {
			updateEntryMock
				.mockRejectedValueOnce(new Error("db down"))
				.mockResolvedValueOnce({ id: "entry-1", headRevisionId: "rev-2" });
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			fireEvent.click(await screen.findByRole("button", { name: "נסה שוב" }));

			await waitFor(() => expect(updateEntryMock).toHaveBeenCalledTimes(2));
			expect(
				await screen.findByText(/נשמר בשרת/, {}, { timeout: 3000 }),
			).toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: "נסה שוב" }),
			).not.toBeInTheDocument();
		});

		it("treats an expired session as a login action and keeps the draft", async () => {
			updateEntryMock.mockRejectedValue(
				new Error("SESSION_EXPIRED: admin session expired"),
			);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			// The draft mirror runs continuously — by the time the commit fails,
			// the edit is already safe on this device.
			fireEvent.click(screen.getByTestId("wysiwyg-editor"));
			await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy());
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			expect(
				await screen.findByRole("button", { name: "התחבר מחדש" }),
			).toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: "נסה שוב" }),
			).not.toBeInTheDocument();
			// The in-flight work is preserved for the post-login reload.
			const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}");
			expect(draft.form.content).toBe("<p>תוכן חדש</p>");
			expect(draft.baseRevisionId).toBe("rev-1");
		});

		it("keeps the draft current as the user edits past a failure", async () => {
			updateEntryMock.mockRejectedValue(new Error("db down"));
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			await screen.findByRole("button", { name: "נסה שוב" });

			// Editing after the failure must reach the draft — a reload
			// offers it back, so a stale snapshot would silently lose work.
			fireEvent.click(screen.getByTestId("wysiwyg-editor"));
			await waitFor(() => {
				const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}");
				expect(draft.form.content).toBe("<p>תוכן חדש</p>");
			});
		});

		it("keeps an LLM edit's attribution for the next explicit commit", async () => {
			getLlmAssistantStatusMock.mockResolvedValue({ enabled: true });
			updateEntryMock
				.mockResolvedValueOnce({ id: "entry-1", headRevisionId: "rev-2" })
				.mockResolvedValueOnce({ id: "entry-1", headRevisionId: "rev-3" });
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			// An LLM apply between commits stays local with its attribution —
			// the next explicit commit carries it, not the acknowledged one.
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			fireEvent.click(screen.getByRole("button", { name: "החל הצעה" }));
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			await waitFor(() => expect(updateEntryMock).toHaveBeenCalledTimes(2));
			expect(updateEntryMock.mock.calls[1]?.[0]).toEqual({
				data: expect.objectContaining({ source: "llm-assistant" }),
			});
		});

		it("cannot duplicate a commit through rapid clicks", async () => {
			const resolvers: Array<(value: unknown) => void> = [];
			updateEntryMock.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolvers.push(resolve);
					}),
			);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			const saveButton = await screen.findByRole("button", {
				name: "שמור עכשיו",
			});
			await waitFor(() => expect(saveButton).toBeEnabled());

			// After the first click the pending state disables the button, so
			// repeat clicks cannot launch a second in-flight request.
			fireEvent.click(saveButton);
			fireEvent.click(saveButton);
			fireEvent.click(saveButton);
			await waitFor(() => expect(updateEntryMock).toHaveBeenCalledTimes(1));
			expect(saveButton).toBeDisabled();

			await act(async () => {
				resolvers[0]?.({ id: "entry-1", headRevisionId: "rev-2" });
			});
			await waitFor(() => expect(saveButton).toBeEnabled());
			// Only the deliberate click after settlement produces a commit.
			expect(updateEntryMock).toHaveBeenCalledTimes(1);
		});

		it("keeps edits made during an in-flight save dirty after it resolves", async () => {
			let resolveSave: (value: unknown) => void = () => undefined;
			updateEntryMock.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveSave = resolve;
					}),
			);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			// mutationFn runs a tick after mutate() — wait for the real call so
			// the resolver is captured before resolving below.
			await waitFor(() => expect(updateEntryMock).toHaveBeenCalledTimes(1));
			// The user keeps editing while the request is in flight.
			fireEvent.click(screen.getByTestId("wysiwyg-editor"));

			await act(async () => {
				resolveSave({ id: "entry-1", headRevisionId: "rev-2" });
			});

			// The acked snapshot predates the edit — the dirty flag must stay.
			expect(
				await screen.findByText("יש שינויים שלא נשמרו בשרת"),
			).toBeInTheDocument();
		});

		it("re-anchors the draft on the new head when edits outlive a commit", async () => {
			let resolveSave: (value: unknown) => void = () => undefined;
			updateEntryMock.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveSave = resolve;
					}),
			);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "שמור עכשיו" }),
				).toBeEnabled(),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			await waitFor(() => expect(updateEntryMock).toHaveBeenCalledTimes(1));
			fireEvent.click(screen.getByTestId("wysiwyg-editor"));

			await act(async () => {
				resolveSave({ id: "entry-1", headRevisionId: "rev-2" });
			});

			// The surviving edits are now based on rev-2 — a reload must not
			// show them as stale-relative-to-rev-1.
			await waitFor(() => {
				const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}");
				expect(draft.baseRevisionId).toBe("rev-2");
			});
		});

		it("does not let a background refetch clobber dirty edits", async () => {
			const client = renderPage();
			await screen.findByTestId("wysiwyg-editor");
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			fireEvent.change(screen.getByLabelText(/כותרת/), {
				target: { value: "כותרת שלא נשמרה" },
			});

			getEntryMock.mockResolvedValue({
				...existingEntry,
				title: "כותרת ישנה מהשרת",
			});
			await act(async () => {
				await client.invalidateQueries({
					queryKey: ["tanahpedia-entry", "entry-1"],
				});
			});

			expect(screen.getByLabelText(/כותרת/)).toHaveValue("כותרת שלא נשמרה");
			expect(screen.getByText("יש שינויים שלא נשמרו בשרת")).toBeInTheDocument();
		});

		it("does not auto-commit further edits after a revision conflict", async () => {
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
			await screen.findByRole("button", { name: "טען מחדש" });
			expect(updateEntryMock).toHaveBeenCalledTimes(1);

			// The conflict stays the editor's problem — edits mirror locally
			// but nothing retries the rejected commit on its own.
			fireEvent.click(screen.getByTestId("wysiwyg-editor"));
			await act(async () => {
				await new Promise((r) => setTimeout(r, 2500));
			});
			expect(updateEntryMock).toHaveBeenCalledTimes(1);
		});
	});

	// Issue #2612: browser-local drafts are the only automatic persistence —
	// recovery, conflict and lifecycle behavior of the scoped draft model.
	describe("local drafts (#2612)", () => {
		it("offers a stored draft for explicit restore instead of applying it", async () => {
			localStorage.setItem(DRAFT_KEY, JSON.stringify(storedDraft()));
			renderPage();
			await screen.findByTestId("wysiwyg-editor");

			// The banner offers the draft — the form still shows server state.
			expect(
				await screen.findByRole("button", { name: "שחזר טיוטה" }),
			).toBeInTheDocument();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			expect(screen.getByLabelText(/כותרת/)).toHaveValue("משה רבנו");

			fireEvent.click(screen.getByRole("button", { name: "שחזר טיוטה" }));
			expect(screen.getByLabelText(/כותרת/)).toHaveValue("טיוטה מקומית");
			expect(screen.getByText("יש שינויים שלא נשמרו בשרת")).toBeInTheDocument();
			expect(updateEntryMock).not.toHaveBeenCalled();
		});

		it("commits a restored stale draft on its own base so the conflict guard applies", async () => {
			updateEntryMock.mockRejectedValue(
				new RevisionConflictError("stale base"),
			);
			localStorage.setItem(
				DRAFT_KEY,
				JSON.stringify(storedDraft({ baseRevisionId: "rev-old" })),
			);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");

			// The server moved since the draft — the offer says so.
			expect(
				await screen.findByText(/הערך בשרת עודכן מאז/),
			).toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: "טען מחדש" }),
			).not.toBeInTheDocument();

			fireEvent.click(
				await screen.findByRole("button", { name: "שחזר טיוטה" }),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			// The commit proposes on the DRAFT's base (rev-old), not the
			// current head — a stale-base restore cannot silently rebase over
			// edits it never saw; the server's guard rejects it instead.
			await waitFor(() =>
				expect(updateEntryMock).toHaveBeenCalledWith({
					data: expect.objectContaining({
						baseRevisionId: "rev-old",
						title: "טיוטה מקומית",
					}),
				}),
			);
			expect(
				await screen.findByRole("button", { name: "טען מחדש" }),
			).toBeInTheDocument();
		});

		it("commits a restored fresh-base draft cleanly", async () => {
			updateEntryMock.mockResolvedValue({
				id: "entry-1",
				headRevisionId: "rev-3",
			});
			localStorage.setItem(DRAFT_KEY, JSON.stringify(storedDraft()));
			renderPage();
			await screen.findByTestId("wysiwyg-editor");

			fireEvent.click(
				await screen.findByRole("button", { name: "שחזר טיוטה" }),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			await waitFor(() =>
				expect(updateEntryMock).toHaveBeenCalledWith({
					data: expect.objectContaining({
						baseRevisionId: "rev-1",
						title: "טיוטה מקומית",
					}),
				}),
			);
		});

		it("keeps an unanswered draft offer through a no-op save", async () => {
			updateEntryMock.mockResolvedValue({
				id: "entry-1",
				headRevisionId: "rev-2",
			});
			localStorage.setItem(DRAFT_KEY, JSON.stringify(storedDraft()));
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			expect(
				await screen.findByRole("button", { name: "שחזר טיוטה" }),
			).toBeInTheDocument();

			// A clean save commits nothing — it must not delete the stored
			// copy of the unreviewed offer or dismiss the banner.
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			await waitFor(() => expect(updateEntryMock).toHaveBeenCalled());

			expect(
				screen.getByRole("button", { name: "שחזר טיוטה" }),
			).toBeInTheDocument();
			expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy();
		});

		it("persists dirty edits synchronously when accepting the server version", async () => {
			updateEntryMock.mockRejectedValue(
				new RevisionConflictError("stale base"),
			);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			// Do NOT wait for the debounced mirror — the whole point is that
			// choosing the server version must not lose un-mirrored work.
			fireEvent.click(screen.getByTestId("wysiwyg-editor"));
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			fireEvent.click(await screen.findByRole("button", { name: "טען מחדש" }));

			await waitFor(() => {
				const raw = localStorage.getItem(DRAFT_KEY);
				expect(raw).toBeTruthy();
				expect(JSON.parse(raw as string).form.content).toBe("<p>תוכן חדש</p>");
			});
		});

		it("re-bases the re-offered draft on the adopted head so its commit succeeds", async () => {
			updateEntryMock
				.mockRejectedValueOnce(new RevisionConflictError("stale base"))
				.mockResolvedValue({ id: "entry-1", headRevisionId: "rev-9" });
			getEntryMock
				.mockResolvedValueOnce(existingEntry)
				.mockResolvedValue({ ...existingEntry, currentRevisionId: "rev-9" });
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			fireEvent.click(screen.getByTestId("wysiwyg-editor"));
			await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy());
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			fireEvent.click(await screen.findByRole("button", { name: "טען מחדש" }));

			// The work is re-offered — now based on the adopted head, so the
			// explicit re-commit lands instead of re-throwing the conflict.
			fireEvent.click(
				await screen.findByRole("button", { name: "שחזר טיוטה" }),
			);
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			await waitFor(() =>
				expect(updateEntryMock).toHaveBeenLastCalledWith({
					data: expect.objectContaining({ baseRevisionId: "rev-9" }),
				}),
			);
		});

		it("carries edits made during a /new create into the created entry's scope", async () => {
			paramsMock.mockReturnValue({ id: "new" });
			let resolveCreate: (v: { id: string; headRevisionId: string }) => void =
				() => {};
			createEntryMock.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveCreate = resolve;
					}),
			);
			renderPage();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			fireEvent.change(screen.getByLabelText(/כותרת/), {
				target: { value: "ערך חדש" },
			});
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			await waitFor(() => expect(createEntryMock).toHaveBeenCalled());

			// Edits typed while the create is still in flight outlive it.
			fireEvent.change(screen.getByLabelText(/כותרת/), {
				target: { value: "ערך חדש - עודכן" },
			});
			await act(async () => {
				resolveCreate({ id: "created-1", headRevisionId: "rev-c1" });
			});

			const transferredKey = `tanahpedia-draft:v2:${ACCOUNT}:entry:created-1`;
			await waitFor(() =>
				expect(localStorage.getItem(transferredKey)).toBeTruthy(),
			);
			const transferred = JSON.parse(
				localStorage.getItem(transferredKey) as string,
			);
			expect(transferred.form.title).toBe("ערך חדש - עודכן");
			expect(transferred.scope).toBe("entry:created-1");
			expect(transferred.baseRevisionId).toBe("rev-c1");
			// And the `new:` key is gone — it must not resurface as an offer.
			expect(Object.keys(localStorage).some((k) => k.includes(":new:"))).toBe(
				false,
			);
		});

		it("offers the next new-entry draft after the newest is discarded", async () => {
			paramsMock.mockReturnValue({ id: "new" });
			localStorage.setItem(
				`tanahpedia-draft:v2:${ACCOUNT}:new:older-draft`,
				JSON.stringify(
					storedDraft({
						scope: "new:older-draft",
						savedAt: "2020-01-01T00:00:00.000Z",
						form: {
							unique_name: "ישן",
							title: "טיוטה ישנה",
							content: "<p>ישן</p>",
						},
					}),
				),
			);
			localStorage.setItem(
				`tanahpedia-draft:v2:${ACCOUNT}:new:latest-draft`,
				JSON.stringify(
					storedDraft({
						scope: "new:latest-draft",
						savedAt: "2026-01-01T00:00:00.000Z",
						form: {
							unique_name: "חדש",
							title: "הטיוטה האחרונה",
							content: "<p>חדש</p>",
						},
					}),
				),
			);
			renderPage();
			await screen.findByRole("tab", { name: "תוכן" });

			// The newest is offered first; discarding it surfaces the next one.
			fireEvent.click(await screen.findByRole("button", { name: "מחק טיוטה" }));
			fireEvent.click(
				await screen.findByRole("button", { name: "שחזר טיוטה" }),
			);
			fireEvent.click(screen.getByRole("tab", { name: "מטא-דאטה" }));
			expect(screen.getByLabelText(/כותרת/)).toHaveValue("טיוטה ישנה");
		});

		it("surfaces an unresolvable editor identity as a local-protection failure", async () => {
			getEditorIdentityMock.mockRejectedValue(
				new Error("editor identity unavailable"),
			);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");

			expect(
				await screen.findByText(/הטיוטה המקומית לא נשמרה/),
			).toBeInTheDocument();
		});

		it("drops a stored draft that already matches the server", async () => {
			localStorage.setItem(
				DRAFT_KEY,
				JSON.stringify(
					storedDraft({
						form: {
							unique_name: "משה-רבנו",
							title: "משה רבנו",
							content: "<p>גוף</p>",
						},
					}),
				),
			);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() => expect(getEditorIdentityMock).toHaveBeenCalled());
			await act(async () => {
				await new Promise((r) => setTimeout(r, 0));
			});

			expect(
				screen.queryByRole("button", { name: "שחזר טיוטה" }),
			).not.toBeInTheDocument();
			expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
		});

		it("ignores drafts stored under a different account", async () => {
			localStorage.setItem(
				"tanahpedia-draft:v2:other-acct:entry:entry-1",
				JSON.stringify(storedDraft({ accountId: "other-acct" })),
			);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await act(async () => {
				await new Promise((r) => setTimeout(r, 0));
			});

			expect(
				screen.queryByRole("button", { name: "שחזר טיוטה" }),
			).not.toBeInTheDocument();
			// And the other account's bytes are left untouched.
			expect(
				localStorage.getItem("tanahpedia-draft:v2:other-acct:entry:entry-1"),
			).toBeTruthy();
		});

		it("discards a pending draft on explicit request", async () => {
			localStorage.setItem(DRAFT_KEY, JSON.stringify(storedDraft()));
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			fireEvent.click(await screen.findByRole("button", { name: "מחק טיוטה" }));

			expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
			expect(
				screen.queryByRole("button", { name: "שחזר טיוטה" }),
			).not.toBeInTheDocument();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			expect(screen.getByLabelText(/כותרת/)).toHaveValue("משה רבנו");
		});

		it("surfaces a malformed stored draft without breaking the editor", async () => {
			localStorage.setItem(DRAFT_KEY, "{not-json!!!");
			renderPage();
			await screen.findByTestId("wysiwyg-editor");

			expect(await screen.findByText(/טיוטה מקומית פגומה/)).toBeInTheDocument();
			// The editor still works; the next write replaces the bad bytes.
			fireEvent.click(screen.getByTestId("wysiwyg-editor"));
			await waitFor(() => {
				const raw = localStorage.getItem(DRAFT_KEY);
				expect(raw).toBeTruthy();
				expect(JSON.parse(raw as string).version).toBe(2);
			});
		});

		it("re-offers the draft after a conflict reload instead of losing it", async () => {
			updateEntryMock.mockRejectedValue(
				new RevisionConflictError("stale base"),
			);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			fireEvent.click(screen.getByTestId("wysiwyg-editor"));
			await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy());
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			fireEvent.click(await screen.findByRole("button", { name: "טען מחדש" }));

			// The conflicted work is NOT discarded — after the fresh head
			// loads, the draft is offered back for an explicit decision.
			expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy();
			expect(
				await screen.findByRole("button", { name: "שחזר טיוטה" }),
			).toBeInTheDocument();
		});

		it("clears the draft once its commit is acknowledged", async () => {
			updateEntryMock.mockResolvedValue({
				id: "entry-1",
				headRevisionId: "rev-2",
			});
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			fireEvent.click(screen.getByTestId("wysiwyg-editor"));
			await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy());
			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

			await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeNull());
			expect(
				await screen.findByText(/נשמר בשרת/, {}, { timeout: 3000 }),
			).toBeInTheDocument();
		});

		it("surfaces a draft write from another tab", async () => {
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			await waitFor(() => expect(getEditorIdentityMock).toHaveBeenCalled());

			act(() => {
				window.dispatchEvent(
					storageEvent(
						DRAFT_KEY,
						JSON.stringify(
							storedDraft({ sessionId: "a-different-tab" }),
						),
					),
				);
			});

			expect(await screen.findByText(/כרטיסייה אחרת/)).toBeInTheDocument();
		});

		it("shows the local-protection failure when storage rejects the write", async () => {
			const setItemSpy = vi
				.spyOn(Storage.prototype, "setItem")
				.mockImplementation(() => {
					throw new Error("QuotaExceededError");
				});
			try {
				renderPage();
				await screen.findByTestId("wysiwyg-editor");
				fireEvent.click(screen.getByTestId("wysiwyg-editor"));

				expect(
					await screen.findByText(/הטיוטה המקומית לא נשמרה/),
				).toBeInTheDocument();
				expect(updateEntryMock).not.toHaveBeenCalled();
			} finally {
				setItemSpy.mockRestore();
			}
		});

		it("reverts uncommitted edits and deletes the draft on בטל שינויים", async () => {
			const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
			renderPage();
			await screen.findByTestId("wysiwyg-editor");
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			fireEvent.change(screen.getByLabelText(/כותרת/), {
				target: { value: "כותרת זמנית" },
			});
			await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy());

			fireEvent.click(screen.getByRole("button", { name: "בטל שינויים" }));

			expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
			expect(screen.getByLabelText(/כותרת/)).toHaveValue("משה רבנו");
			expect(updateEntryMock).not.toHaveBeenCalled();
			confirmSpy.mockRestore();
		});

		it("mirrors /new edits under a stable new-entry draft key and clears it on create", async () => {
			paramsMock.mockReturnValue({ id: "new" });
			createEntryMock.mockResolvedValue({
				id: "created-1",
				headRevisionId: "rev-c1",
			});
			renderPage();
			fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
			fireEvent.change(screen.getByLabelText(/כותרת/), {
				target: { value: "ערך חדש" },
			});

			// The draft lives under a `new:` scope — before any entry exists.
			const newKey = await waitFor(() => {
				const key = Object.keys(localStorage).find(
					(k) =>
						k.startsWith(`tanahpedia-draft:v2:${ACCOUNT}:new:`) &&
						localStorage.getItem(k),
				);
				expect(key).toBeTruthy();
				return key as string;
			});
			expect(updateEntryMock).not.toHaveBeenCalled();

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			await waitFor(() => expect(createEntryMock).toHaveBeenCalled());
			// The committed new-entry draft is gone — it must not re-appear as
			// an offer on the next /new visit.
			await waitFor(() => expect(localStorage.getItem(newKey)).toBeNull());
		});

		it("offers the latest new-entry draft on a fresh /new visit", async () => {
			paramsMock.mockReturnValue({ id: "new" });
			localStorage.setItem(
				`tanahpedia-draft:v2:${ACCOUNT}:new:older-draft`,
				JSON.stringify(
					storedDraft({
						scope: "new:older-draft",
						savedAt: "2020-01-01T00:00:00.000Z",
						form: {
							unique_name: "ישן",
							title: "טיוטה ישנה",
							content: "<p>ישן</p>",
						},
					}),
				),
			);
			localStorage.setItem(
				`tanahpedia-draft:v2:${ACCOUNT}:new:latest-draft`,
				JSON.stringify(
					storedDraft({
						scope: "new:latest-draft",
						savedAt: "2026-01-01T00:00:00.000Z",
						form: {
							unique_name: "חדש",
							title: "הטיוטה האחרונה",
							content: "<p>חדש</p>",
						},
					}),
				),
			);
			renderPage();
			await screen.findByRole("tab", { name: "תוכן" });

			fireEvent.click(
				await screen.findByRole("button", { name: "שחזר טיוטה" }),
			);
			fireEvent.click(screen.getByRole("tab", { name: "מטא-דאטה" }));
			expect(screen.getByLabelText(/כותרת/)).toHaveValue("הטיוטה האחרונה");
		});
	});

	describe("deleting", () => {
		it("deletes the entry after confirmation and goes back to the list", async () => {
			const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
			deleteEntryMock.mockResolvedValue({ success: true });
			localStorage.setItem(DRAFT_KEY, JSON.stringify(storedDraft()));
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
			// A deleted entry's draft can never commit — it is removed.
			expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
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

	it("forgets a created-entry id when the route param changes", async () => {
		paramsMock.mockReturnValue({ id: "new" });
		createEntryMock.mockResolvedValue({
			id: "created-1",
			headRevisionId: "rev-new",
		});
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const { component: Page } = Route as unknown as {
			component: () => React.ReactElement;
		};
		const utils = render(
			<QueryClientProvider client={client}>
				<Page />
			</QueryClientProvider>,
		);
		const rerender = () =>
			utils.rerender(
				<QueryClientProvider client={client}>
					<Page />
				</QueryClientProvider>,
			);

		fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
		fireEvent.change(screen.getByLabelText(/כותרת/), {
			target: { value: "ערך ראשון" },
		});
		fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
		await waitFor(() => expect(createEntryMock).toHaveBeenCalledTimes(1));

		// The router reuses this component across param changes — landing on a
		// second /new must not update the previously created entry.
		paramsMock.mockReturnValue({ id: "created-1" });
		rerender();
		paramsMock.mockReturnValue({ id: "new" });
		rerender();

		fireEvent.click(await screen.findByRole("tab", { name: "מטא-דאטה" }));
		fireEvent.change(screen.getByLabelText(/כותרת/), {
			target: { value: "ערך שני" },
		});
		fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
		await waitFor(() => expect(createEntryMock).toHaveBeenCalledTimes(2));
		expect(updateEntryMock).not.toHaveBeenCalled();
	});
});
