import { beforeEach, describe, expect, it, vi } from "vitest";
import { RevisionConflictError } from "~/lib/tanahpedia/revisions-shared";

// Issue #2611 regression: the persistent save failure on אדם came from
// server errors surfacing as silent, endlessly-retried rejections. These
// tests pin the server-side contract the client now relies on: input errors
// carry a classifiable VALIDATION prefix, MySQL write failures the editor can
// fix are translated into the same class, and genuine conflicts keep their
// REVISION_CONFLICT shape. (The live-DB reproduction that diagnosed the issue
// ran against a local tanah-dev fixture; this file is its durable mock-based
// equivalent so CI can run it without a database.)

const { transactionMock, txExecuteMock, txQueryOneMock, loadEntryMock } =
	vi.hoisted(() => {
		const conn = { marker: "tx-conn" };
		return {
			conn,
			transactionMock: vi.fn(async (fn: (c: typeof conn) => unknown) =>
				fn(conn),
			),
			txExecuteMock: vi.fn(),
			txQueryOneMock: vi.fn(),
			loadEntryMock: vi.fn(),
		};
	});

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
vi.mock("@tanstack/react-start/server-only", () => ({}));

vi.mock("~/server/db", () => ({
	execute: vi.fn(),
	query: vi.fn(),
	queryOne: vi.fn(),
	transaction: transactionMock,
	txExecute: txExecuteMock,
	txQueryOne: txQueryOneMock,
}));

vi.mock("~/server/tanahpedia/entry-loader.server", () => ({
	loadTanahpediaEntryById: loadEntryMock,
}));

import { updateEntry } from "~/server/tanahpedia/entries";
import { saveEntryRevisioned } from "~/server/tanahpedia/revisions";

const ADAM = {
	id: "2611-adam-0000-4000-8000-000000000001",
	unique_name: "אדם",
	title: "אדם",
	content: "<p>ערך אדם</p>",
	created_at: "2024-01-01",
	updated_at: "2024-01-01",
};

const ADAM_HEAD = {
	id: "2611-head-0000-4000-8000-0000000000h1",
	entry_id: ADAM.id,
	proposed_unique_name: "אדם",
	proposed_title: "אדם",
	proposed_content: "<p>ערך אדם</p>",
	source: "admin",
	notes: null,
	status: "APPLIED",
	base_revision_id: null,
	created_at: "2024-01-01",
	updated_at: "2024-01-01",
};

const fakeConn = {} as never;

function mockCommittedSave() {
	txQueryOneMock
		.mockResolvedValueOnce(ADAM) // lockEntry
		.mockResolvedValueOnce(ADAM_HEAD) // headRevision
		.mockResolvedValueOnce(ADAM); // post-save reload
}

const validInput = {
	id: ADAM.id,
	unique_name: "אדם",
	title: "אדם",
	content: "<p>עריכה חדשה</p>",
	baseRevisionId: ADAM_HEAD.id,
	source: "admin",
	notes: null,
};

describe("issue 2611: server save contract", () => {
	beforeEach(() => {
		transactionMock.mockReset().mockImplementation(async (fn) => fn(fakeConn));
		txExecuteMock.mockReset();
		txQueryOneMock.mockReset();
		loadEntryMock.mockReset();
	});

	it("saves a Hebrew entry through the revisioned path", async () => {
		mockCommittedSave();
		const result = await updateEntry({ data: validInput });
		expect(result.headRevisionId).toEqual(expect.any(String));
	});

	it("rejects a blank title before touching the database", async () => {
		await expect(
			updateEntry({ data: { ...validInput, title: "   " } }),
		).rejects.toThrow("VALIDATION:");
		expect(txQueryOneMock).not.toHaveBeenCalled();
	});

	it("rejects a blank unique name before touching the database", async () => {
		await expect(
			updateEntry({ data: { ...validInput, unique_name: "" } }),
		).rejects.toThrow("VALIDATION:");
		expect(txQueryOneMock).not.toHaveBeenCalled();
	});

	it("translates a unique-name collision into a VALIDATION error", async () => {
		txQueryOneMock.mockResolvedValueOnce(ADAM).mockResolvedValueOnce(ADAM_HEAD);
		txExecuteMock.mockRejectedValue({
			code: "ER_DUP_ENTRY",
			errno: 1062,
			message: "Duplicate entry 'אדם' for key 'uk_entry_unique_name'",
		});

		// utf8mb4_unicode_ci equates nikud/trailing-space variants, so this is
		// the persistent per-entry failure class a raw 500 used to hide.
		await expect(
			saveEntryRevisioned(fakeConn, {
				...validInput,
				unique_name: "אָדָם",
			}),
		).rejects.toThrow("VALIDATION: השם הייחודי כבר תפוס");
	});

	it("translates an oversized field into a VALIDATION error", async () => {
		txQueryOneMock.mockResolvedValueOnce(ADAM).mockResolvedValueOnce(ADAM_HEAD);
		txExecuteMock.mockRejectedValue({
			code: "ER_DATA_TOO_LONG",
			errno: 1406,
			message: "Data too long for column 'proposed_content'",
		});

		await expect(saveEntryRevisioned(fakeConn, validInput)).rejects.toThrow(
			"VALIDATION:",
		);
	});

	it("keeps the REVISION_CONFLICT error shape for a moved head", async () => {
		txQueryOneMock.mockResolvedValueOnce(ADAM).mockResolvedValueOnce(ADAM_HEAD);

		await expect(
			saveEntryRevisioned(fakeConn, {
				...validInput,
				baseRevisionId: "rev-superseded",
			}),
		).rejects.toThrow(RevisionConflictError);
	});

	it("passes through unrecognized database failures unchanged", async () => {
		txQueryOneMock.mockResolvedValueOnce(ADAM).mockResolvedValueOnce(ADAM_HEAD);
		const raw = Object.assign(
			new Error("Table 'tanahpedia_entry_revision' doesn't exist"),
			{ code: "ER_NO_SUCH_TABLE", errno: 1146 },
		);
		txExecuteMock.mockRejectedValue(raw);

		await expect(saveEntryRevisioned(fakeConn, validInput)).rejects.toThrow(
			"doesn't exist",
		);
	});
});
