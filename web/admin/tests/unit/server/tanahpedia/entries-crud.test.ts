import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const conn = { marker: "tx-conn" };
	return {
		conn,
		execute: vi.fn(),
		queryOne: vi.fn(),
		query: vi.fn(),
		txExecute: vi.fn(),
		txQueryOne: vi.fn(),
		transaction: vi.fn(async (fn: (c: typeof conn) => unknown) => fn(conn)),
		loadEntryMock: vi.fn(),
		saveRevisionedMock: vi.fn(),
	};
});

vi.mock("@tanstack/react-start", () => ({
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
	execute: mocks.execute,
	query: mocks.query,
	queryOne: mocks.queryOne,
	transaction: mocks.transaction,
	txExecute: mocks.txExecute,
	txQueryOne: mocks.txQueryOne,
}));

vi.mock("~/server/tanahpedia/entry-loader.server", () => ({
	loadTanahpediaEntryById: mocks.loadEntryMock,
}));

vi.mock("~/server/tanahpedia/revisions", () => ({
	saveEntryRevisioned: mocks.saveRevisionedMock,
}));

import {
	assignEntity,
	createEntry,
	deleteEntry,
	getEntries,
	getEntry,
	getEntryEntities,
	getTanahpediaCategoryCounts,
	listTanahpediaEntriesForAdmin,
	removeEntity,
	updateEntry,
} from "~/server/tanahpedia/entries";

describe("tanahpedia entry server functions", () => {
	beforeEach(() => {
		for (const mock of [
			mocks.execute,
			mocks.queryOne,
			mocks.query,
			mocks.txExecute,
			mocks.txQueryOne,
			mocks.transaction,
			mocks.loadEntryMock,
			mocks.saveRevisionedMock,
		])
			mock.mockReset();
		mocks.transaction.mockImplementation(async (fn) => fn(mocks.conn));
	});

	describe("listTanahpediaEntriesForAdmin", () => {
		it("tolerates an undefined payload and lists everything", async () => {
			mocks.query.mockResolvedValue([{ id: "entry-1" }]);

			await expect(
				listTanahpediaEntriesForAdmin({ data: undefined }),
			).resolves.toEqual([{ id: "entry-1" }]);
			expect(mocks.query.mock.calls[0]?.[0]).toContain("FROM tanahpedia_entry");
		});

		it("matches a free-text query against title and unique_name", async () => {
			mocks.query.mockResolvedValue([{ id: "entry-1" }]);

			await listTanahpediaEntriesForAdmin({
				data: { q: "  משה  " },
			});

			const [sql, params] = mocks.query.mock.calls[0] ?? [];
			expect(String(sql)).toContain("WHERE title LIKE ? OR unique_name LIKE ?");
			expect(String(sql)).toContain("LIMIT 300");
			expect(params).toEqual(["%משה%", "%משה%"]);
		});

		it("falls back to the unfiltered list for an unknown category", async () => {
			mocks.query.mockResolvedValue([{ id: "entry-1" }]);

			await listTanahpediaEntriesForAdmin({
				data: { category: "not-a-category" },
			});

			const [sql, params] = mocks.query.mock.calls[0] ?? [];
			expect(String(sql)).toContain("FROM tanahpedia_entry");
			expect(String(sql)).not.toContain("JOIN");
			expect(String(sql)).toContain("LIMIT 500");
			expect(params).toBeUndefined();
		});

		it.each(["PROPHET", "KING"])(
			"joins the person role table for category %s",
			async (category) => {
				mocks.query.mockResolvedValue([{ id: "entry-1" }]);

				await listTanahpediaEntriesForAdmin({
					data: { category: category.toLowerCase() },
				});

				const [sql] = mocks.query.mock.calls[0] ?? [];
				expect(String(sql)).toContain(
					`tanahpedia_person_role_${category.toLowerCase()}`,
				);
				expect(String(sql)).toContain("INNER JOIN tanahpedia_person");
			},
		);

		it("joins the animal kind table for an animal-kind category", async () => {
			mocks.query.mockResolvedValue([{ id: "entry-1" }]);

			await listTanahpediaEntriesForAdmin({
				data: { category: "BEHEMA", q: "פסל" },
			});

			const [sql, params] = mocks.query.mock.calls[0] ?? [];
			expect(String(sql)).toContain("tanahpedia_animal_kind ak");
			expect(String(sql)).toContain("ak.kind = ?");
			expect(String(sql)).toContain("ent.title LIKE ?");
			expect(params).toEqual(["BEHEMA", "%פסל%", "%פסל%"]);
		});

		it("joins the animal purity table for a purity category", async () => {
			mocks.query.mockResolvedValue([{ id: "entry-1" }]);

			await listTanahpediaEntriesForAdmin({
				data: { category: "TAHOR" },
			});

			const [sql, params] = mocks.query.mock.calls[0] ?? [];
			expect(String(sql)).toContain("tanahpedia_animal_purity ap");
			expect(String(sql)).toContain("ap.purity = ?");
			expect(params).toEqual(["TAHOR"]);
		});

		it("filters by entity_type for a plain entity category", async () => {
			mocks.query.mockResolvedValue([{ id: "entry-1" }]);

			await listTanahpediaEntriesForAdmin({
				data: { category: "PERSON" },
			});

			const [sql, params] = mocks.query.mock.calls[0] ?? [];
			expect(String(sql)).toContain("WHERE e.entity_type = ?");
			expect(String(sql)).not.toContain("tanahpedia_person");
			expect(params).toEqual(["PERSON"]);
		});
	});

	describe("getEntries", () => {
		it("lists every entry ordered by title", async () => {
			mocks.query.mockResolvedValue([{ id: "entry-1" }]);

			await expect(getEntries()).resolves.toEqual([{ id: "entry-1" }]);
			expect(mocks.query.mock.calls[0]?.[0]).toContain("ORDER BY title");
		});
	});

	describe("getTanahpediaCategoryCounts", () => {
		it("merges entity-type, person-role, and animal counts into one map", async () => {
			mocks.query.mockImplementation((sql: string) => {
				if (String(sql).includes("GROUP BY e.entity_type")) {
					return Promise.resolve([
						{ entityType: "PERSON", cnt: 4 },
						{ entityType: "PLACE", cnt: 2 },
					]);
				}
				if (String(sql).includes("person_role_prophet")) {
					return Promise.resolve([
						{ role: "PROPHET", cnt: 3 },
						{ role: "KING", cnt: 1 },
					]);
				}
				return Promise.resolve([
					{ cat: "BEHEMA", cnt: 5 },
					{ cat: "TAHOR", cnt: 2 },
				]);
			});

			const result = await getTanahpediaCategoryCounts();

			expect(result.counts.PERSON).toBe(4);
			expect(result.counts.PLACE).toBe(2);
			expect(result.counts.PROPHET).toBe(3);
			expect(result.counts.KING).toBe(1);
			expect(result.counts.BEHEMA).toBe(5);
			expect(result.counts.TAHOR).toBe(2);
			expect(result.counts.CHAYA).toBe(0);
			expect(result.labels).toMatchObject({ PERSON: "אישים" });
			expect(mocks.query).toHaveBeenCalledTimes(3);
		});
	});

	describe("getEntry", () => {
		it("returns the entry with its current head revision id", async () => {
			mocks.loadEntryMock.mockResolvedValue({
				id: "entry-1",
				title: "כותרת",
			});
			mocks.queryOne.mockResolvedValue({ id: "rev-head" });

			await expect(getEntry({ data: "entry-1" })).resolves.toEqual({
				id: "entry-1",
				title: "כותרת",
				currentRevisionId: "rev-head",
			});
		});

		it("reports a missing head revision as null", async () => {
			mocks.loadEntryMock.mockResolvedValue({ id: "entry-1" });
			mocks.queryOne.mockResolvedValue(null);

			await expect(getEntry({ data: "entry-1" })).resolves.toMatchObject({
				currentRevisionId: null,
			});
		});

		it("throws when the entry does not exist", async () => {
			mocks.loadEntryMock.mockResolvedValue(null);

			await expect(getEntry({ data: "missing" })).rejects.toThrow(
				"Entry not found",
			);
			expect(mocks.queryOne).not.toHaveBeenCalled();
		});
	});

	describe("createEntry", () => {
		it("inserts the entry and its applied head revision in one transaction", async () => {
			mocks.txExecute.mockResolvedValue({ insertId: 1 });
			mocks.txQueryOne.mockResolvedValue({
				id: "entry-new",
				unique_name: "שם",
				title: "כותרת",
				content: "<p>גוף</p>",
				created_at: "2026-01-01",
				updated_at: "2026-01-01",
			});

			const result = await createEntry({
				data: {
					id: "entry-new",
					unique_name: "שם",
					title: "כותרת",
					content: "<p>גוף</p>",
					source: "admin",
					notes: " הערה ",
				},
			});

			expect(mocks.transaction).toHaveBeenCalledTimes(1);
			const statements = mocks.txExecute.mock.calls.map((c) => String(c[1]));
			expect(statements[0]).toContain("INSERT INTO tanahpedia_entry ");
			expect(statements[1]).toContain("INSERT INTO tanahpedia_entry_revision");
			// The initial revision is recorded APPLIED with the trimmed notes.
			expect(mocks.txExecute.mock.calls[1]?.[2]).toContain("הערה");
			expect(result.headRevisionId).toEqual(expect.any(String));
			expect(result.id).toBe("entry-new");
		});

		it("throws when the inserted row cannot be read back", async () => {
			mocks.txExecute.mockResolvedValue({ insertId: 1 });
			mocks.txQueryOne.mockResolvedValue(null);

			await expect(
				createEntry({
					data: {
						id: "entry-new",
						unique_name: "שם",
						title: "כותרת",
						content: "",
					},
				}),
			).rejects.toThrow("Entry not found");
		});
	});

	describe("updateEntry", () => {
		it("saves through the revisioned writer inside a transaction", async () => {
			mocks.saveRevisionedMock.mockResolvedValue({
				entry: { id: "entry-1", title: "כותרת" },
				headRevisionId: "rev-2",
			});

			const input = {
				id: "entry-1",
				unique_name: "שם",
				title: "כותרת",
				content: "<p>גוף</p>",
				baseRevisionId: "rev-1",
				source: "admin",
			};
			await expect(updateEntry({ data: input })).resolves.toEqual({
				id: "entry-1",
				title: "כותרת",
				headRevisionId: "rev-2",
			});
			expect(mocks.saveRevisionedMock).toHaveBeenCalledWith(mocks.conn, input);
		});
	});

	describe("deleteEntry", () => {
		it("deletes the entry row", async () => {
			mocks.execute.mockResolvedValue({ affectedRows: 1 });

			await expect(deleteEntry({ data: "entry-1" })).resolves.toEqual({
				success: true,
			});
			expect(mocks.execute).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_entry WHERE id = ?",
				["entry-1"],
			);
		});
	});

	describe("entry entity links", () => {
		it("lists the entities linked to an entry", async () => {
			mocks.query.mockResolvedValue([
				{ id: "link-1", entry_id: "entry-1", entity_id: "e-1" },
			]);

			await expect(getEntryEntities({ data: "entry-1" })).resolves.toEqual([
				{ id: "link-1", entry_id: "entry-1", entity_id: "e-1" },
			]);
			expect(mocks.query.mock.calls[0]?.[1]).toEqual(["entry-1"]);
		});

		it("assigns an entity to an entry", async () => {
			mocks.execute.mockResolvedValue({ insertId: 1 });

			await expect(
				assignEntity({
					data: { id: "link-1", entry_id: "entry-1", entity_id: "e-1" },
				}),
			).resolves.toEqual({ success: true });
			expect(mocks.execute).toHaveBeenCalledWith(
				expect.stringContaining("INSERT INTO tanahpedia_entry_entity"),
				["link-1", "entry-1", "e-1"],
			);
		});

		it("removes an entity link", async () => {
			mocks.execute.mockResolvedValue({ affectedRows: 1 });

			await expect(removeEntity({ data: "link-1" })).resolves.toEqual({
				success: true,
			});
			expect(mocks.execute).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_entry_entity WHERE id = ?",
				["link-1"],
			);
		});
	});

	describe("website cache invalidation", () => {
		const ENV_KEYS = [
			"VITE_WEBSITE_URL",
			"REVALIDATE_SECRET",
		] as const;
		let savedEnv: Record<string, string | undefined>;
		let fetchSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			savedEnv = {};
			for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
			process.env.VITE_WEBSITE_URL = "https://site.test";
			process.env.REVALIDATE_SECRET = "s3cr3t";
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

		function revalidateCalls() {
			return fetchSpy.mock.calls.map((call: unknown[]) => {
				const url = new URL(String(call[0]));
				return {
					tag: url.searchParams.get("tag"),
					path: url.searchParams.get("path"),
					type: url.searchParams.get("type"),
				};
			});
		}

		// The pedia surface set: entity refs feeding perek pages, every
		// entry/category/disambiguation route, and the index.
		const PEDIA_CALLS = [
			{ tag: "tanahpedia-entity-refs", path: null, type: null },
			{ tag: null, path: "/pedia/[slug]", type: "page" },
			{ tag: null, path: "/pedia", type: null },
		];

		it("expires pedia surfaces after an entry create", async () => {
			mocks.txExecute.mockResolvedValue({ insertId: 1 });
			mocks.txQueryOne.mockResolvedValue({
				id: "entry-new",
				unique_name: "שם",
				title: "כותרת",
				content: "",
				created_at: "2026-01-01",
				updated_at: "2026-01-01",
			});

			await createEntry({
				data: {
					id: "entry-new",
					unique_name: "שם",
					title: "כותרת",
					content: "",
				},
			});

			expect(revalidateCalls()).toEqual(PEDIA_CALLS);
		});

		it("expires pedia surfaces after a changed update", async () => {
			mocks.saveRevisionedMock.mockResolvedValue({
				entry: { id: "entry-1" },
				headRevisionId: "rev-2",
			});

			await updateEntry({
				data: {
					id: "entry-1",
					unique_name: "שם",
					title: "כותרת",
					content: "<p>גוף</p>",
				},
			});

			expect(revalidateCalls()).toEqual(PEDIA_CALLS);
		});

		it("skips invalidation when the save was a no-op", async () => {
			mocks.saveRevisionedMock.mockResolvedValue({
				entry: { id: "entry-1" },
				headRevisionId: "rev-1",
				unchanged: true,
			});

			await updateEntry({
				data: {
					id: "entry-1",
					unique_name: "שם",
					title: "כותרת",
					content: "<p>גוף</p>",
				},
			});

			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it("expires pedia surfaces after delete and entity link changes", async () => {
			mocks.execute.mockResolvedValue({ affectedRows: 1 });

			await deleteEntry({ data: "entry-1" });
			expect(revalidateCalls()).toEqual(PEDIA_CALLS);

			fetchSpy.mockClear();
			await assignEntity({
				data: { id: "link-1", entry_id: "entry-1", entity_id: "e-1" },
			});
			expect(revalidateCalls()).toEqual(PEDIA_CALLS);

			fetchSpy.mockClear();
			await removeEntity({ data: "link-1" });
			expect(revalidateCalls()).toEqual(PEDIA_CALLS);
		});
	});
});
