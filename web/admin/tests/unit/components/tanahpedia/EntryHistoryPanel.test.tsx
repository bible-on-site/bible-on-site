import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EntryRevisionRow } from "~/lib/tanahpedia/revisions-shared";

const { approveMock, listMock, rejectMock, restoreMock } = vi.hoisted(() => ({
	approveMock: vi.fn(),
	listMock: vi.fn(),
	rejectMock: vi.fn(),
	restoreMock: vi.fn(),
}));

vi.mock("~/server/tanahpedia/revisions", () => ({
	approveEntryRevision: approveMock,
	listEntryRevisions: listMock,
	rejectEntryRevision: rejectMock,
	restoreEntryRevision: restoreMock,
}));

import { EntryHistoryPanel } from "~/components/tanahpedia/EntryHistoryPanel";

function makeRevision(
	overrides: Partial<EntryRevisionRow> = {},
): EntryRevisionRow {
	return {
		id: "rev-00000001",
		entry_id: "entry-1",
		proposed_unique_name: null,
		proposed_title: null,
		proposed_content: "<p>new</p>",
		source: "admin",
		notes: null,
		status: "APPLIED",
		base_revision_id: null,
		created_at: "2026-10-01T10:00:00Z",
		updated_at: "2026-10-01T10:00:00Z",
		...overrides,
	};
}

function renderPanel(
	props: Partial<Parameters<typeof EntryHistoryPanel>[0]> = {},
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<EntryHistoryPanel
				entryId="entry-1"
				currentContent="<p>current</p>"
				baseRevisionId={null}
				onEntryChanged={vi.fn()}
				{...props}
			/>
		</QueryClientProvider>,
	);
}

describe("EntryHistoryPanel", () => {
	it("shows loading state while revisions load", () => {
		listMock.mockReturnValue(new Promise(() => {}));
		renderPanel();
		expect(screen.getByText("טוען היסטוריה...")).toBeInTheDocument();
	});

	it("shows empty state when there are no revisions", async () => {
		listMock.mockResolvedValue([]);
		renderPanel();
		expect(
			await screen.findByText(/אין עדיין גרסאות לערך זה/),
		).toBeInTheDocument();
	});

	it("renders revision rows with status badge, source and notes", async () => {
		listMock.mockResolvedValue([
			makeRevision({
				proposed_title: "כותרת חדשה",
				notes: "הערות בדיקה",
				source: "llm-assistant",
			}),
		]);
		renderPanel();
		expect(await screen.findByText("הוחל")).toBeInTheDocument();
		expect(screen.getByText("llm-assistant")).toBeInTheDocument();
		expect(screen.getByText("הערות בדיקה")).toBeInTheDocument();
		expect(screen.getByText("כותרת חדשה")).toBeInTheDocument();
	});

	it("toggles the diff view showing added and removed words", async () => {
		listMock.mockResolvedValue([
			makeRevision({ proposed_content: "hello old world" }),
		]);
		renderPanel({ currentContent: "hello new world" });
		fireEvent.click(await screen.findByText("הצג הבדלים"));
		expect(screen.getByText("new")).toBeInTheDocument();
		expect(screen.getByText("old")).toBeInTheDocument();
		fireEvent.click(screen.getByText("הסתר הבדלים"));
		expect(screen.queryByText("new")).not.toBeInTheDocument();
	});

	it("toggles the sanitized preview of the proposed content", async () => {
		listMock.mockResolvedValue([
			makeRevision({ proposed_content: "<p>תצוגה</p>" }),
		]);
		renderPanel();
		fireEvent.click(await screen.findByText("תצוגה מקדימה"));
		expect(screen.getByText("תצוגה")).toBeInTheDocument();
		fireEvent.click(screen.getByText("הסתר תצוגה"));
	});

	it("approves a pending revision and refreshes", async () => {
		const onEntryChanged = vi.fn();
		listMock.mockResolvedValue([
			makeRevision({ status: "PENDING", source: "llm-assistant" }),
		]);
		approveMock.mockResolvedValue({});
		renderPanel({ onEntryChanged });
		fireEvent.click(await screen.findByText("אשר והחל"));
		await waitFor(() => expect(approveMock).toHaveBeenCalled());
		await waitFor(() => expect(onEntryChanged).toHaveBeenCalled());
		expect(listMock).toHaveBeenCalledTimes(2);
	});

	it("rejects a pending revision", async () => {
		listMock.mockResolvedValue([makeRevision({ status: "PENDING" })]);
		rejectMock.mockResolvedValue({});
		renderPanel();
		fireEvent.click(await screen.findByText("דחה"));
		await waitFor(() => expect(rejectMock).toHaveBeenCalled());
	});

	it("restores an applied revision only after confirmation", async () => {
		listMock.mockResolvedValue([makeRevision({ status: "APPLIED" })]);
		restoreMock.mockResolvedValue({});
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		renderPanel({ baseRevisionId: "rev-00000001" });
		fireEvent.click(await screen.findByText("שחזר גרסה זו"));
		expect(restoreMock).not.toHaveBeenCalled();

		confirmSpy.mockReturnValue(true);
		fireEvent.click(screen.getByText("שחזר גרסה זו"));
		await waitFor(() =>
			expect(restoreMock).toHaveBeenCalledWith({
				data: { id: "rev-00000001", baseRevisionId: "rev-00000001" },
			}),
		);
		confirmSpy.mockRestore();
	});

	it("shows a friendly message on revision conflict errors", async () => {
		listMock.mockResolvedValue([makeRevision({ status: "PENDING" })]);
		approveMock.mockRejectedValue(new Error("REVISION_CONFLICT: stale head"));
		renderPanel();
		fireEvent.click(await screen.findByText("אשר והחל"));
		expect(
			await screen.findByText(/נשמר בינתיים בסשן אחר/),
		).toBeInTheDocument();
	});
});
