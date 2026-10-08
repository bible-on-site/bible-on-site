import { beforeEach, describe, expect, it, vi } from "vitest";
import { RevisionConflictError } from "~/lib/tanahpedia/revisions-shared";

const {
	executeMock,
	queryMock,
	transactionMock,
	txExecuteMock,
	txQueryOneMock,
} = vi.hoisted(() => ({
	executeMock: vi.fn(),
	queryMock: vi.fn(),
	transactionMock: vi.fn(),
	txExecuteMock: vi.fn(),
	txQueryOneMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
	createServerOnlyFn: (fn: unknown) => fn,
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
}));

vi.mock("~/server/db", () => ({
	execute: executeMock,
	query: queryMock,
	transaction: transactionMock,
	txExecute: txExecuteMock,
	txQueryOne: txQueryOneMock,
}));

import {
	approveEntryRevision,
	listEntryRevisions,
	rejectEntryRevision,
	restoreEntryRevision,
	saveEntryRevisioned,
} from "~/server/tanahpedia/revisions";

const ENTRY = {
	id: "entry-1",
	unique_name: "yaakov",
	title: "יעקב",
	content: "<p>old</p>",
	created_at: "2024-01-01",
	updated_at: "2024-01-01",
};

const HEAD = {
	id: "rev-head",
	entry_id: "entry-1",
	proposed_unique_name: "yaakov",
	proposed_title: "יעקב",
	proposed_content: "<p>old</p>",
	source: "admin",
	notes: null,
	status: "APPLIED",
	base_revision_id: null,
	created_at: "2024-01-01",
	updated_at: "2024-01-01",
	age_seconds: 7200,
};

const fakeConn = {} as never;

function mockSaveQueries(head: typeof HEAD | null = HEAD) {
	txQueryOneMock
		.mockResolvedValueOnce(ENTRY) // lockEntry
		.mockResolvedValueOnce(head) // headRevision
		.mockResolvedValueOnce(ENTRY); // post-save reload
}

describe("saveEntryRevisioned", () => {
	beforeEach(() => {
		transactionMock.mockReset();
		txExecuteMock.mockReset();
		txQueryOneMock.mockReset();
	});

	it("rejects a missing entry", async () => {
		txQueryOneMock.mockResolvedValueOnce(null);
		await expect(
			saveEntryRevisioned(fakeConn, {
				id: "gone",
				unique_name: "x",
				title: "x",
				content: "x",
				baseRevisionId: null,
			}),
		).rejects.toThrow("Entry not found");
	});

	it("returns early on a no-op save without writing history", async () => {
		mockSaveQueries();
		const result = await saveEntryRevisioned(fakeConn, {
			id: "entry-1",
			unique_name: "yaakov",
			title: "יעקב",
			content: "<p>old</p>",
			baseRevisionId: "rev-head",
		});
		expect(result.headRevisionId).toBe("rev-head");
		expect(txExecuteMock).not.toHaveBeenCalled();
	});

	it("rejects a stale base revision", async () => {
		txQueryOneMock.mockResolvedValueOnce(ENTRY).mockResolvedValueOnce(HEAD);
		await expect(
			saveEntryRevisioned(fakeConn, {
				id: "entry-1",
				unique_name: "yaakov",
				title: "יעקב",
				content: "<p>new</p>",
				baseRevisionId: "rev-old",
			}),
		).rejects.toThrow(RevisionConflictError);
		expect(txExecuteMock).not.toHaveBeenCalled();
	});

	it("inserts an APPLIED revision based on the current head", async () => {
		mockSaveQueries();
		const result = await saveEntryRevisioned(fakeConn, {
			id: "entry-1",
			unique_name: "yaakov",
			title: "יעקב אבינו",
			content: "<p>new</p>",
			baseRevisionId: "rev-head",
		});

		const insert = txExecuteMock.mock.calls.find(([, sql]) =>
			(sql as string).includes("INSERT INTO tanahpedia_entry_revision"),
		);
		expect(insert).toBeTruthy();
		expect(insert?.[2]).toEqual([
			expect.any(String),
			"entry-1",
			"yaakov",
			"יעקב אבינו",
			"<p>new</p>",
			"admin",
			null,
			"rev-head",
		]);
		const entryUpdate = txExecuteMock.mock.calls.find(([, sql]) =>
			(sql as string).includes("UPDATE tanahpedia_entry SET"),
		);
		expect(entryUpdate).toBeTruthy();
		expect(result.headRevisionId).toEqual(expect.any(String));
	});

	it("squashes a same-source save inside the window into the head revision", async () => {
		mockSaveQueries({ ...HEAD, source: "admin", age_seconds: 30 });
		const result = await saveEntryRevisioned(fakeConn, {
			id: "entry-1",
			unique_name: "yaakov",
			title: "יעקב",
			content: "<p>new</p>",
			baseRevisionId: "rev-head",
		});
		const update = txExecuteMock.mock.calls.find(([, sql]) =>
			(sql as string).includes("UPDATE tanahpedia_entry_revision"),
		);
		expect(update).toBeTruthy();
		// WHERE id = ? is the last param
		expect(update?.[2]?.[4]).toBe("rev-head");
		expect(
			txExecuteMock.mock.calls.some(([, sql]) =>
				(sql as string).includes("INSERT INTO tanahpedia_entry_revision"),
			),
		).toBe(false);
		expect(result.headRevisionId).toBe("rev-head");
	});

	it("opens a new revision when the source differs despite a fresh head", async () => {
		mockSaveQueries({ ...HEAD, source: "admin", age_seconds: 30 });
		await saveEntryRevisioned(fakeConn, {
			id: "entry-1",
			unique_name: "yaakov",
			title: "יעקב",
			content: "<p>llm</p>",
			baseRevisionId: "rev-head",
			source: "llm-assistant",
		});
		expect(
			txExecuteMock.mock.calls.some(([, sql]) =>
				(sql as string).includes("INSERT INTO tanahpedia_entry_revision"),
			),
		).toBe(true);
	});

	it("skips squashing when options.squash is false", async () => {
		mockSaveQueries({ ...HEAD, source: "admin", age_seconds: 30 });
		await saveEntryRevisioned(
			fakeConn,
			{
				id: "entry-1",
				unique_name: "yaakov",
				title: "יעקב",
				content: "<p>new</p>",
				baseRevisionId: "rev-head",
			},
			{ squash: false },
		);
		expect(
			txExecuteMock.mock.calls.some(([, sql]) =>
				(sql as string).includes("INSERT INTO tanahpedia_entry_revision"),
			),
		).toBe(true);
	});
});

describe("approveEntryRevision", () => {
	beforeEach(() => {
		transactionMock.mockReset().mockImplementation((cb) => cb(fakeConn));
		txExecuteMock.mockReset();
		txQueryOneMock.mockReset();
	});

	it("rejects a missing revision", async () => {
		txQueryOneMock.mockResolvedValueOnce(null);
		await expect(approveEntryRevision({ data: { id: "r1" } })).rejects.toThrow(
			"Revision not found",
		);
	});

	it("rejects an already-applied revision", async () => {
		txQueryOneMock.mockResolvedValueOnce({ ...HEAD, id: "r1" });
		await expect(approveEntryRevision({ data: { id: "r1" } })).rejects.toThrow(
			"already been applied",
		);
	});

	it("rejects when the declared base is stale", async () => {
		txQueryOneMock
			.mockResolvedValueOnce({
				...HEAD,
				id: "r1",
				status: "PENDING",
				base_revision_id: "rev-old",
			})
			.mockResolvedValueOnce(ENTRY)
			.mockResolvedValueOnce(HEAD);
		await expect(approveEntryRevision({ data: { id: "r1" } })).rejects.toThrow(
			RevisionConflictError,
		);
	});

	it("applies to the live entry and stamps the displaced head", async () => {
		txQueryOneMock
			.mockResolvedValueOnce({
				...HEAD,
				id: "r1",
				status: "PENDING",
				base_revision_id: null,
				proposed_title: "יעקב אבינו",
			})
			.mockResolvedValueOnce(ENTRY)
			.mockResolvedValueOnce(HEAD);
		const result = await approveEntryRevision({ data: { id: "r1" } });
		expect(result).toEqual({
			revisionId: "r1",
			entryId: "entry-1",
			headRevisionId: "r1",
		});
		const entryUpdate = txExecuteMock.mock.calls.find(([, sql]) =>
			(sql as string).includes("UPDATE tanahpedia_entry\n"),
		);
		expect(entryUpdate).toBeTruthy();
		const stamp = txExecuteMock.mock.calls.find(([, sql]) =>
			(sql as string).includes("status = 'APPLIED'"),
		);
		expect(stamp?.[2]).toEqual(["entry-1", "rev-head", "r1"]);
	});

	it("creates a new entry for an unlinked proposal", async () => {
		txQueryOneMock.mockResolvedValueOnce({
			...HEAD,
			id: "r1",
			entry_id: null,
			status: "PENDING",
			base_revision_id: null,
			proposed_unique_name: "new-entry",
			proposed_title: "ערך חדש",
		});
		const result = await approveEntryRevision({ data: { id: "r1" } });
		const insert = txExecuteMock.mock.calls.find(([, sql]) =>
			(sql as string).includes("INSERT INTO tanahpedia_entry"),
		);
		expect(insert).toBeTruthy();
		expect(result.entryId).toEqual(expect.any(String));
	});

	it("requires proposedUniqueName/proposedTitle for new entries", async () => {
		txQueryOneMock.mockResolvedValueOnce({
			...HEAD,
			id: "r1",
			entry_id: null,
			status: "PENDING",
			base_revision_id: null,
			proposed_unique_name: null,
			proposed_title: null,
		});
		await expect(approveEntryRevision({ data: { id: "r1" } })).rejects.toThrow(
			"proposedUniqueName and proposedTitle",
		);
	});
});

describe("rejectEntryRevision", () => {
	it("marks the proposal REJECTED only while PENDING", async () => {
		executeMock.mockReset().mockResolvedValue(undefined);
		await rejectEntryRevision({ data: { id: "r1" } });
		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("status = 'REJECTED'"),
			["r1"],
		);
	});
});

describe("restoreEntryRevision", () => {
	beforeEach(() => {
		transactionMock.mockReset().mockImplementation((cb) => cb(fakeConn));
		txExecuteMock.mockReset();
		txQueryOneMock.mockReset();
	});

	it("rejects a revision not linked to an entry", async () => {
		txQueryOneMock.mockResolvedValueOnce({ ...HEAD, entry_id: null });
		await expect(
			restoreEntryRevision({ data: { id: "r1", baseRevisionId: null } }),
		).rejects.toThrow("not linked to an entry");
	});

	it("rejects when the editor's base is stale", async () => {
		txQueryOneMock
			.mockResolvedValueOnce({ ...HEAD, id: "old-rev" })
			.mockResolvedValueOnce(ENTRY)
			.mockResolvedValueOnce(HEAD);
		await expect(
			restoreEntryRevision({ data: { id: "old-rev", baseRevisionId: "x" } }),
		).rejects.toThrow(RevisionConflictError);
	});

	it("writes a new APPLIED restore revision based on the head", async () => {
		txQueryOneMock
			.mockResolvedValueOnce({
				...HEAD,
				id: "old-rev",
				proposed_title: "גרסה ישנה",
			})
			.mockResolvedValueOnce(ENTRY)
			.mockResolvedValueOnce(HEAD)
			.mockResolvedValueOnce(ENTRY);
		await restoreEntryRevision({
			data: { id: "old-rev", baseRevisionId: "rev-head" },
		});
		const insert = txExecuteMock.mock.calls.find(([, sql]) =>
			(sql as string).includes("INSERT INTO tanahpedia_entry_revision"),
		);
		expect(insert?.[1]).toContain("'APPLIED'");
		// last param is base_revision_id — the displaced head
		expect(insert?.[2]?.[7]).toBe("rev-head");
	});
});

describe("listEntryRevisions", () => {
	it("returns revisions newest-first for the entry", async () => {
		queryMock.mockReset().mockResolvedValueOnce([HEAD]);
		const rows = await listEntryRevisions({ data: "entry-1" });
		expect(queryMock).toHaveBeenCalledWith(
			expect.stringContaining("WHERE entry_id = ?"),
			["entry-1"],
		);
		expect(rows).toEqual([HEAD]);
	});
});
