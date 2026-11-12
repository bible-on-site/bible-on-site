import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, queryMock, queryOneMock, transactionMock } = vi.hoisted(
	() => ({
		executeMock: vi.fn(),
		queryMock: vi.fn(),
		queryOneMock: vi.fn(),
		transactionMock: vi.fn(),
	}),
);

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: () => unknown) => () => fn(),
	}),
}));

vi.mock("~/server/db", () => ({
	execute: executeMock,
	query: queryMock,
	queryOne: queryOneMock,
	transaction: (fn: (conn: unknown) => unknown) => {
		transactionMock();
		return fn({});
	},
	txExecute: (_conn: unknown, sql: string, params?: unknown[]) =>
		executeMock(sql, params),
	txQuery: (_conn: unknown, sql: string, params?: unknown[]) =>
		queryMock(sql, params),
	txQueryOne: (_conn: unknown, sql: string, params?: unknown[]) =>
		queryOneMock(sql, params),
}));

import {
	deleteEntityExternalReference,
	upsertEntityExternalReference,
} from "~/server/tanahpedia/external-references";
import {
	removeEntityExternalReference,
	setEntityExternalReference,
} from "~/server/tanahpedia/external-references.server";
import { __resetRevalidateForTests } from "~/server/website-revalidate";

const ENTITY_LOCK_SQL =
	"SELECT id FROM tanahpedia_entity WHERE id = ? FOR UPDATE";

/** Entity exists + live mapping rows queued in call order. */
function mockState(entityId: string | null, currentUrl: string | null) {
	queryOneMock
		.mockResolvedValueOnce(entityId ? { id: entityId } : null)
		.mockResolvedValueOnce(currentUrl ? { url: currentUrl } : null);
}

describe("setEntityExternalReference", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
		transactionMock.mockReset();
	});

	it("inserts a normalized Wikidata mapping when none exists", async () => {
		mockState("entity-1", null);

		await expect(
			setEntityExternalReference({
				entityId: "entity-1",
				source: "WIKIDATA",
				url: "q9181",
				expectedUrl: null,
			}),
		).resolves.toEqual({
			url: "https://www.wikidata.org/wiki/Q9181",
		});

		expect(queryOneMock).toHaveBeenCalledWith(ENTITY_LOCK_SQL, ["entity-1"]);
		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO external_reference"),
			[
				"TANAHPEDIA_ENTITY",
				"entity-1",
				"WIKIDATA",
				"https://www.wikidata.org/wiki/Q9181",
			],
		);
	});

	it("claims the pair so a deploy rerun cannot overwrite the write", async () => {
		mockState("entity-1", null);

		await setEntityExternalReference({
			entityId: "entity-1",
			source: "WIKIDATA",
			url: "Q9181",
			expectedUrl: null,
		});

		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("INSERT IGNORE INTO external_reference_seed"),
			["TANAHPEDIA_ENTITY", "entity-1", "WIKIDATA"],
		);
	});

	it("still saves when the claim ledger is not deployed yet", async () => {
		mockState("entity-1", null);
		executeMock
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" });

		await expect(
			setEntityExternalReference({
				entityId: "entity-1",
				source: "WIKIDATA",
				url: "Q9181",
				expectedUrl: null,
			}),
		).resolves.toEqual({
			url: "https://www.wikidata.org/wiki/Q9181",
		});
	});

	it("updates the row when the live URL matches the snapshot", async () => {
		mockState("entity-1", "https://www.wikidata.org/wiki/Q9181");

		await setEntityExternalReference({
			entityId: "entity-1",
			source: "WIKIDATA",
			url: "https://www.wikidata.org/wiki/Q42",
			expectedUrl: "https://www.wikidata.org/wiki/Q9181",
		});

		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE external_reference SET url = ?"),
			[
				"https://www.wikidata.org/wiki/Q42",
				"TANAHPEDIA_ENTITY",
				"entity-1",
				"WIKIDATA",
			],
		);
	});

	it("writes nothing when the normalized URL is already stored", async () => {
		mockState("entity-1", "https://www.wikidata.org/wiki/Q9181");

		await setEntityExternalReference({
			entityId: "entity-1",
			source: "WIKIDATA",
			url: "Q9181",
			expectedUrl: "https://www.wikidata.org/wiki/Q9181",
		});

		expect(executeMock).not.toHaveBeenCalled();
	});

	it("rejects a stale snapshot instead of overwriting a newer mapping", async () => {
		mockState("entity-1", "https://www.wikidata.org/wiki/Q42");

		await expect(
			setEntityExternalReference({
				entityId: "entity-1",
				source: "WIKIDATA",
				url: "Q9181",
				expectedUrl: "https://www.wikidata.org/wiki/Q1",
			}),
		).rejects.toThrow("המיפוי השתנה על ידי עורך אחר");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("rejects an add when another admin already mapped the source", async () => {
		mockState("entity-1", "https://www.sefaria.org/topics/x");

		await expect(
			setEntityExternalReference({
				entityId: "entity-1",
				source: "SEFARIA",
				url: "https://www.sefaria.org/topics/abraham",
				expectedUrl: null,
			}),
		).rejects.toThrow("המיפוי השתנה על ידי עורך אחר");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("rejects when the entity does not exist", async () => {
		mockState(null, null);

		await expect(
			setEntityExternalReference({
				entityId: "ghost",
				source: "WIKIDATA",
				url: "Q1",
				expectedUrl: null,
			}),
		).rejects.toThrow("היישות לא נמצאה");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("rejects an invalid URL before touching the database", async () => {
		await expect(
			setEntityExternalReference({
				entityId: "entity-1",
				source: "WIKIPEDIA_HE",
				url: "https://en.wikipedia.org/wiki/Abraham",
				expectedUrl: null,
			}),
		).rejects.toThrow("קישור ויקיפדיה לא תקין");
		expect(transactionMock).not.toHaveBeenCalled();
	});
});

describe("removeEntityExternalReference", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
		transactionMock.mockReset();
	});

	it("deletes the row when the snapshot matches", async () => {
		mockState("entity-1", "https://www.sefaria.org/topics/abraham");

		await expect(
			removeEntityExternalReference({
				entityId: "entity-1",
				source: "SEFARIA",
				expectedUrl: "https://www.sefaria.org/topics/abraham",
			}),
		).resolves.toBeUndefined();

		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("DELETE FROM external_reference"),
			["TANAHPEDIA_ENTITY", "entity-1", "SEFARIA"],
		);
	});

	it("claims the pair in the same commit so a rerun cannot restore it", async () => {
		mockState("entity-1", "https://www.sefaria.org/topics/abraham");

		await removeEntityExternalReference({
			entityId: "entity-1",
			source: "SEFARIA",
			expectedUrl: "https://www.sefaria.org/topics/abraham",
		});

		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("INSERT IGNORE INTO external_reference_seed"),
			["TANAHPEDIA_ENTITY", "entity-1", "SEFARIA"],
		);
	});

	it("refuses an unprotected removal while the ledger is missing", async () => {
		mockState("entity-1", "https://www.sefaria.org/topics/abraham");
		executeMock
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" });

		await expect(
			removeEntityExternalReference({
				entityId: "entity-1",
				source: "SEFARIA",
				expectedUrl: "https://www.sefaria.org/topics/abraham",
			}),
		).rejects.toThrow("טבלאות external_reference עדיין לא פרוסו");
	});

	it("rejects removal of an already-absent mapping", async () => {
		mockState("entity-1", null);

		await expect(
			removeEntityExternalReference({
				entityId: "entity-1",
				source: "SEFARIA",
				expectedUrl: null,
			}),
		).rejects.toThrow("המיפוי כבר הוסר");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("rejects removal when the mapping changed since the snapshot", async () => {
		mockState("entity-1", "https://www.sefaria.org/topics/new");

		await expect(
			removeEntityExternalReference({
				entityId: "entity-1",
				source: "SEFARIA",
				expectedUrl: "https://www.sefaria.org/topics/old",
			}),
		).rejects.toThrow("המיפוי השתנה על ידי עורך אחר");
		expect(executeMock).not.toHaveBeenCalled();
	});
});

describe("server functions", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
		transactionMock.mockReset();
	});

	it("rejects an unsupported source", async () => {
		await expect(
			upsertEntityExternalReference({
				data: {
					entityId: "entity-1",
					source: "GOOGLE",
					url: "https://x",
					expectedUrl: null,
				},
			}),
		).rejects.toThrow("מקור לא נתמך");
		await expect(
			deleteEntityExternalReference({
				data: {
					entityId: "entity-1",
					source: "GOOGLE",
					expectedUrl: null,
				},
			}),
		).rejects.toThrow("מקור לא נתמך");
	});

	it("returns the canonical url on upsert", async () => {
		mockState("entity-1", null);

		await expect(
			upsertEntityExternalReference({
				data: {
					entityId: "entity-1",
					source: "WIKIDATA",
					url: "Q9181",
					expectedUrl: null,
				},
			}),
		).resolves.toEqual({
			success: true,
			url: "https://www.wikidata.org/wiki/Q9181",
		});
	});
});

describe("external-reference writes invalidate the website", () => {
	const ENV_KEYS = ["VITE_WEBSITE_URL", "REVALIDATE_SECRET"] as const;
	let savedEnv: Record<string, string | undefined>;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		process.env.VITE_WEBSITE_URL = "https://site.test";
		process.env.REVALIDATE_SECRET = "s3cr3t";
		__resetRevalidateForTests();
		fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
		fetchSpy.mockRestore();
	});

	function sentChanges(): Record<string, unknown>[] {
		return fetchSpy.mock.calls.flatMap((call: unknown[]) => {
			const body = (call[1] as RequestInit | undefined)?.body;
			return body ? (JSON.parse(String(body)).changes ?? []) : [];
		});
	}

	function mockEntityResolution(entityId: string, entryNames: string[]) {
		queryMock
			.mockResolvedValueOnce([{ id: entityId, entity_type: "PERSON" }])
			.mockResolvedValueOnce(
				entryNames.map((unique_name) => ({
					entity_id: entityId,
					unique_name,
				})),
			)
			.mockResolvedValueOnce([]);
	}

	it("expires the entity's entry pages after an upsert commit", async () => {
		mockState("entity-1", null);
		mockEntityResolution("entity-1", ["אברהם"]);

		await upsertEntityExternalReference({
			data: {
				entityId: "entity-1",
				source: "WIKIDATA",
				url: "Q9181",
				expectedUrl: null,
			},
		});

		expect(sentChanges()).toEqual([
			{
				kind: "pedia-entity",
				entityId: "entity-1",
				entityType: "PERSON",
				entryUniqueNames: ["אברהם"],
				refPerekIds: [],
			},
		]);
	});

	it("expires the entity's entry pages after a removal commit", async () => {
		mockState("entity-1", "https://www.wikidata.org/wiki/Q9181");
		mockEntityResolution("entity-1", ["אברהם"]);

		await deleteEntityExternalReference({
			data: {
				entityId: "entity-1",
				source: "WIKIDATA",
				expectedUrl: "https://www.wikidata.org/wiki/Q9181",
			},
		});

		expect(sentChanges()).toEqual([
			{
				kind: "pedia-entity",
				entityId: "entity-1",
				entityType: "PERSON",
				entryUniqueNames: ["אברהם"],
				refPerekIds: [],
			},
		]);
	});

	it("sends no invalidation when the save fails", async () => {
		mockState("entity-1", "https://www.wikidata.org/wiki/Q42");

		await expect(
			upsertEntityExternalReference({
				data: {
					entityId: "entity-1",
					source: "WIKIDATA",
					url: "Q9181",
					expectedUrl: null,
				},
			}),
		).rejects.toThrow("המיפוי השתנה על ידי עורך אחר");

		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
