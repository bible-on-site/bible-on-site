import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const conn = { marker: "tx-conn" };
	return {
		conn,
		execute: vi.fn(),
		queryOne: vi.fn(),
		query: vi.fn(),
		txExecute: vi.fn(),
		txQuery: vi.fn(),
		txQueryOne: vi.fn(),
		transaction: vi.fn(async (fn: (c: typeof conn) => unknown) => fn(conn)),
	};
});
vi.mock("~/server/db", () => mocks);
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

import {
	_resetArticleSearchQueueCache,
	createArticle,
	deleteArticle,
	getArticle,
	getArticles,
	getArticlesByPerek,
	invalidateArticleCache,
	invalidatePerekCache,
	updateArticle,
} from "~/server/articles";

const article = {
	perek_id: 1,
	author_id: 2,
	abstract: "",
	name: "מאמר",
	priority: 1,
	content: "<p>תוכן</p>",
	distributable: true,
};

describe("article reads", () => {
	beforeEach(() => {
		for (const mock of [
			mocks.execute,
			mocks.queryOne,
			mocks.query,
			mocks.txExecute,
			mocks.txQuery,
			mocks.txQueryOne,
		])
			mock.mockReset();
		mocks.transaction.mockClear();
		_resetArticleSearchQueueCache();
	});

	it("lists all articles ordered by perek and priority", async () => {
		mocks.query.mockResolvedValue([{ id: 1, name: "מאמר" }]);

		await expect(getArticles()).resolves.toEqual([{ id: 1, name: "מאמר" }]);
		expect(mocks.query).toHaveBeenCalledWith(
			expect.stringContaining("FROM tanah_article"),
		);
	});

	it("returns the articles of one perek with the author name joined", async () => {
		mocks.query.mockResolvedValue([{ id: 3, author_name: 'רש"י' }]);

		await expect(getArticlesByPerek({ data: 42 })).resolves.toEqual([
			{ id: 3, author_name: 'רש"י' },
		]);
		const [sql, params] = mocks.query.mock.calls[0] ?? [];
		expect(String(sql)).toContain("LEFT JOIN tanah_author");
		expect(params).toEqual([42]);
	});

	it("throws when the requested article does not exist", async () => {
		mocks.queryOne.mockResolvedValue(null);

		await expect(getArticle({ data: 999 })).rejects.toThrow(
			"Article not found",
		);
	});
});

describe("article reads on a pre-upgrade schema", () => {
	const errBadField = Object.assign(new Error("bad field"), {
		code: "ER_BAD_FIELD_ERROR",
	});

	beforeEach(() => {
		for (const mock of [
			mocks.execute,
			mocks.queryOne,
			mocks.query,
			mocks.txExecute,
			mocks.txQuery,
			mocks.txQueryOne,
		])
			mock.mockReset();
		mocks.transaction.mockClear();
		_resetArticleSearchQueueCache();
	});

	it("degrades the article list when the coverage columns are missing", async () => {
		mocks.query
			.mockRejectedValueOnce(errBadField)
			.mockResolvedValueOnce([{ id: 1, name: "מאמר" }]);

		await expect(getArticles()).resolves.toEqual([
			{ id: 1, name: "מאמר", coverage_verified: false },
		]);
		expect(mocks.query).toHaveBeenCalledTimes(2);
		expect(String(mocks.query.mock.calls[1]?.[0])).not.toContain(
			"coverage_verified",
		);
	});

	it("degrades the perek article list when the coverage columns are missing", async () => {
		mocks.query
			.mockRejectedValueOnce(errBadField)
			.mockResolvedValueOnce([{ id: 3 }]);

		await expect(getArticlesByPerek({ data: 42 })).resolves.toEqual([
			{ id: 3 },
		]);
		expect(String(mocks.query.mock.calls[1]?.[0])).not.toContain(
			"coverage_verified",
		);
	});

	it("propagates non-schema list failures", async () => {
		mocks.query.mockRejectedValue(new Error("connection reset"));

		await expect(getArticles()).rejects.toThrow("connection reset");
		expect(mocks.query).toHaveBeenCalledTimes(1);
	});

	it("degrades article fetch when the coverage schema is missing", async () => {
		mocks.queryOne
			.mockRejectedValueOnce(errBadField)
			.mockResolvedValueOnce({ id: 7, name: "מאמר" });
		mocks.query.mockRejectedValue(errBadField);

		const result = await getArticle({ data: 7 });

		expect(result).toMatchObject({
			id: 7,
			coverage_verified: false,
			coveringSources: undefined,
		});
		expect(mocks.queryOne).toHaveBeenCalledTimes(2);
	});

	it("propagates a non-schema failure when fetching one article", async () => {
		mocks.queryOne.mockRejectedValue(new Error("deadlock"));

		await expect(getArticle({ data: 7 })).rejects.toThrow("deadlock");
	});

	it("propagates non-schema failures in the perek article list", async () => {
		mocks.query.mockRejectedValue(new Error("deadlock"));

		await expect(getArticlesByPerek({ data: 42 })).rejects.toThrow("deadlock");
	});

	it("reports a missing article when the degraded retry returns null", async () => {
		mocks.queryOne
			.mockRejectedValueOnce(errBadField)
			.mockResolvedValueOnce(null);

		await expect(getArticle({ data: 999 })).rejects.toThrow(
			"Article not found",
		);
		expect(mocks.queryOne).toHaveBeenCalledTimes(2);
	});
});

describe("article write validation", () => {
	beforeEach(() => {
		for (const mock of [
			mocks.execute,
			mocks.queryOne,
			mocks.query,
			mocks.txExecute,
			mocks.txQuery,
			mocks.txQueryOne,
		])
			mock.mockReset();
		mocks.transaction.mockClear();
		_resetArticleSearchQueueCache();
		mocks.execute.mockResolvedValue({});
	});

	it.each([
		["name", { ...article, name: "" }],
		["perek_id", { ...article, perek_id: 0 }],
		["author_id", { ...article, author_id: 0 }],
	])("rejects a create missing %s before touching the db", async (_, data) => {
		await expect(createArticle({ data })).rejects.toThrow(
			"Name, perek_id, and author_id are required",
		);
		expect(mocks.execute).not.toHaveBeenCalled();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it.each([
		["name", { ...article, id: 7, name: "" }],
		["perek_id", { ...article, id: 7, perek_id: 0 }],
		["author_id", { ...article, id: 7, author_id: 0 }],
	])("rejects an update missing %s before touching the db", async (_, data) => {
		await expect(updateArticle({ data })).rejects.toThrow(
			"Name, perek_id, and author_id are required",
		);
		expect(mocks.execute).not.toHaveBeenCalled();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("rolls back the create when the new row cannot be read back", async () => {
		mocks.txExecute.mockResolvedValue({ insertId: 7 });
		mocks.txQueryOne.mockResolvedValue(null);

		await expect(createArticle({ data: article })).rejects.toThrow(
			"Failed to retrieve created article",
		);
	});

	it("persists null/0 fallbacks for empty optional fields on create", async () => {
		mocks.txExecute.mockResolvedValue({ insertId: 7 });
		mocks.txQueryOne.mockResolvedValue({ id: 7, name: "מאמר" });

		await createArticle({
			data: {
				...article,
				abstract: "",
				priority: 0,
				distributable: false,
				content: "",
			},
		});

		const insert = mocks.txExecute.mock.calls.find(([, sql]) =>
			String(sql).includes("INSERT INTO tanah_article"),
		);
		expect(insert?.[2]).toEqual([1, 2, null, "מאמר", 1, false, null]);
	});

	it("persists null/0 fallbacks for empty optional fields on update", async () => {
		mocks.txExecute.mockResolvedValue({ insertId: 0 });
		mocks.txQueryOne.mockResolvedValue({ id: 7, name: "מאמר" });

		await updateArticle({
			data: {
				...article,
				id: 7,
				abstract: "",
				priority: 0,
				distributable: false,
				content: "",
			},
		});

		const update = mocks.txExecute.mock.calls.find(([, sql]) =>
			String(sql).includes("UPDATE tanah_article"),
		);
		expect(update?.[2]).toEqual([1, 2, null, "מאמר", 1, false, null, 7]);
	});
});

describe("article covering sources", () => {
	const errMissingTable = Object.assign(new Error("no such table"), {
		code: "ER_NO_SUCH_TABLE",
	});

	/** SQL strings of every statement run through the (mock) transaction conn. */
	const txSql = () => mocks.txExecute.mock.calls.map(([, sql]) => String(sql));

	beforeEach(() => {
		for (const mock of [
			mocks.execute,
			mocks.queryOne,
			mocks.query,
			mocks.txExecute,
			mocks.txQuery,
			mocks.txQueryOne,
		])
			mock.mockReset();
		mocks.transaction.mockClear();
		_resetArticleSearchQueueCache();
		mocks.execute.mockResolvedValue({});
		// txQuery serves two readers: pasuk-count bounds and the read-back of
		// persisted covering rows — answer by statement shape.
		mocks.txQuery.mockImplementation((_: unknown, sql: string) => {
			if (sql.includes("pasuk_count")) {
				return Promise.resolve([{ id: 1, pasuk_count: 31 }]);
			}
			return Promise.resolve([{ perek_id: 1, pasuk: 5 }]);
		});
	});

	it("persists covering sources with the article in one transaction", async () => {
		mocks.txExecute.mockResolvedValue({ insertId: 7 });
		mocks.txQueryOne.mockResolvedValue({
			id: 7,
			name: "מאמר",
			coverage_verified: true,
		});

		const saved = await createArticle({
			data: {
				...article,
				coveringSources: [
					{ perek_id: 1, pasuk: 5 },
					{ perek_id: 1, pasuk: 7 },
				],
				coverageVerified: true,
			},
		});

		const coveringInsert = mocks.txExecute.mock.calls.find(([, sql]) =>
			String(sql).includes("INSERT INTO tanah_article_covering_source"),
		);
		expect(coveringInsert?.[2]).toEqual([7, 1, 5, 7, 1, 7]);
		const flagUpdate = txSql().find((sql) => sql.includes("coverage_verified"));
		expect(flagUpdate).toContain("UPDATE tanah_article");
		expect(saved.coveringSources).toEqual([{ perek_id: 1, pasuk: 5 }]);
	});

	it("validates coordinates before inserting the article", async () => {
		await expect(
			createArticle({
				data: {
					...article,
					coveringSources: [{ perek_id: 1, pasuk: 0 }],
				},
			}),
		).rejects.toThrow("at least 1");
		expect(
			txSql().some((sql) => sql.includes("INSERT INTO tanah_article")),
		).toBe(false);
	});

	it("rejects duplicate mappings without touching the database", async () => {
		await expect(
			updateArticle({
				data: {
					...article,
					id: 7,
					coveringSources: [
						{ perek_id: 1, pasuk: 5 },
						{ perek_id: 1, pasuk: 5 },
					],
				},
			}),
		).rejects.toThrow("Duplicate covering source");
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("rejects a perek that does not exist", async () => {
		mocks.txQuery.mockResolvedValue([]);
		mocks.txExecute.mockResolvedValue({});

		await expect(
			updateArticle({
				data: {
					...article,
					id: 7,
					coveringSources: [{ perek_id: 999, pasuk: 1 }],
				},
			}),
		).rejects.toThrow("perek 999 does not exist");
	});

	it("rejects a pasuk beyond the canonical perek bound", async () => {
		mocks.txExecute.mockResolvedValue({});

		await expect(
			updateArticle({
				data: {
					...article,
					id: 7,
					coveringSources: [{ perek_id: 1, pasuk: 99 }],
				},
			}),
		).rejects.toThrow("out of range");
	});

	it("rejects the write when canonical pasuk counts were never loaded", async () => {
		mocks.txQuery.mockResolvedValue([{ id: 1, pasuk_count: null }]);
		mocks.txExecute.mockResolvedValue({});

		await expect(
			updateArticle({
				data: {
					...article,
					id: 7,
					coveringSources: [{ perek_id: 1, pasuk: 5 }],
				},
			}),
		).rejects.toThrow("Canonical pasuk count is missing");
	});

	it("omitted coveringSources leaves coverage state untouched", async () => {
		mocks.txExecute.mockResolvedValue({});
		mocks.txQueryOne.mockResolvedValue({ id: 7, name: "מאמר" });

		await updateArticle({ data: { ...article, id: 7 } });

		expect(
			txSql().some((sql) => sql.includes("tanah_article_covering_source")),
		).toBe(false);
		expect(txSql().some((sql) => sql.includes("coverage_verified"))).toBe(
			false,
		);
	});

	it("an explicit empty list clears mappings and marks coverage unknown", async () => {
		mocks.txExecute.mockResolvedValue({});
		mocks.txQueryOne.mockResolvedValue({ id: 7, name: "מאמר" });

		await updateArticle({
			data: { ...article, id: 7, coveringSources: [], coverageVerified: false },
		});

		expect(
			txSql().some((sql) =>
				sql.includes("DELETE FROM tanah_article_covering_source"),
			),
		).toBe(true);
		expect(
			txSql().some((sql) =>
				sql.includes("INSERT INTO tanah_article_covering_source"),
			),
		).toBe(false);
		const flagUpdate = mocks.txExecute.mock.calls.find(([, sql]) =>
			String(sql).includes("coverage_verified"),
		);
		expect(flagUpdate?.[2]).toEqual([false, 7]);
	});

	it("rejects verified coverage with an explicitly empty mapping set", async () => {
		mocks.txExecute.mockResolvedValue({});

		await expect(
			updateArticle({
				data: {
					...article,
					id: 7,
					coveringSources: [],
					coverageVerified: true,
				},
			}),
		).rejects.toThrow(
			"Verified coverage requires at least one covering source",
		);
	});

	it("coverageVerified alone updates only the flag and requires stored rows", async () => {
		mocks.txQuery.mockImplementation((_: unknown, sql: string) => {
			if (sql.includes("COUNT(*)")) {
				return Promise.resolve([{ covering_count: 0 }]);
			}
			return Promise.resolve([]);
		});
		mocks.txExecute.mockResolvedValue({});

		await expect(
			updateArticle({ data: { ...article, id: 7, coverageVerified: true } }),
		).rejects.toThrow("no covering sources");
		expect(
			txSql().some((sql) => sql.includes("tanah_article_covering_source")),
		).toBe(false);
	});

	it("delete removes covering rows inside the same transaction", async () => {
		mocks.txExecute.mockResolvedValue({});

		await deleteArticle({ data: 7 });

		const coveringDelete = mocks.txExecute.mock.calls.findIndex(([, sql]) =>
			String(sql).includes("DELETE FROM tanah_article_covering_source"),
		);
		const articleDelete = mocks.txExecute.mock.calls.findIndex(([, sql]) =>
			String(sql).includes("DELETE FROM tanah_article WHERE"),
		);
		expect(coveringDelete).toBeGreaterThanOrEqual(0);
		expect(articleDelete).toBeGreaterThan(coveringDelete);
	});

	it("delete tolerates a pre-upgrade schema with no covering table", async () => {
		mocks.txExecute.mockImplementation((_: unknown, sql: string) => {
			if (String(sql).includes("tanah_article_covering_source")) {
				return Promise.reject(errMissingTable);
			}
			return Promise.resolve({});
		});

		await expect(deleteArticle({ data: 7 })).resolves.toEqual({
			success: true,
		});
	});

	it("an unverified empty coverage write tolerates a pre-upgrade schema", async () => {
		// The new-article form always submits coveringSources: [] — on a
		// database without the covering-source schema "coverage unknown" is
		// already the only possible state, so the save must not fail.
		mocks.txExecute.mockImplementation((_: unknown, sql: string) => {
			if (
				String(sql).includes("tanah_article_covering_source") ||
				String(sql).includes("coverage_verified")
			) {
				return Promise.reject(errMissingTable);
			}
			return Promise.resolve({ insertId: 7 });
		});
		mocks.txQueryOne.mockResolvedValue({ id: 7, name: "מאמר" });
		mocks.txQuery.mockRejectedValue(errMissingTable);

		const saved = await createArticle({
			data: { ...article, coveringSources: [], coverageVerified: false },
		});
		expect(saved.id).toBe(7);

		mocks.txQueryOne.mockResolvedValue({ id: 7, name: "מאמר" });
		await expect(
			updateArticle({
				data: {
					...article,
					id: 7,
					coveringSources: [],
					coverageVerified: false,
				},
			}),
		).resolves.toMatchObject({ id: 7 });
	});

	it("authored covering rows still fail when the schema is missing", async () => {
		mocks.txQuery.mockRejectedValue(
			Object.assign(new Error("unknown column"), {
				code: "ER_BAD_FIELD_ERROR",
			}),
		);
		mocks.txExecute.mockResolvedValue({});

		await expect(
			updateArticle({
				data: {
					...article,
					id: 7,
					coveringSources: [{ perek_id: 1, pasuk: 5 }],
					coverageVerified: true,
				},
			}),
		).rejects.toThrow("unknown column");
	});

	it("coverageVerified:true alone surfaces failure when the schema is missing", async () => {
		mocks.txQuery.mockRejectedValue(errMissingTable);
		mocks.txExecute.mockResolvedValue({});

		await expect(
			updateArticle({ data: { ...article, id: 7, coverageVerified: true } }),
		).rejects.toThrow("no such table");
	});

	it("coverageVerified:false alone tolerates a pre-upgrade schema", async () => {
		mocks.txExecute.mockImplementation((_: unknown, sql: string) => {
			if (String(sql).includes("coverage_verified")) {
				return Promise.reject(
					Object.assign(new Error("unknown column"), {
						code: "ER_BAD_FIELD_ERROR",
					}),
				);
			}
			return Promise.resolve({});
		});
		mocks.txQueryOne.mockResolvedValue({ id: 7, name: "מאמר" });

		await expect(
			updateArticle({
				data: { ...article, id: 7, coverageVerified: false },
			}),
		).resolves.toMatchObject({ id: 7 });
	});

	it("degrades the read-back column list when a save runs on a pre-upgrade schema", async () => {
		mocks.txExecute.mockImplementation((_: unknown, sql: string) => {
			if (String(sql).includes("tanah_article_covering_source")) {
				return Promise.reject(errMissingTable);
			}
			return Promise.resolve({ insertId: 7 });
		});
		mocks.txQueryOne.mockImplementation((_: unknown, sql: string) => {
			if (String(sql).includes("coverage_verified")) {
				return Promise.reject(errMissingTable);
			}
			return Promise.resolve({ id: 7, name: "מאמר" });
		});
		mocks.txQuery.mockRejectedValue(errMissingTable);

		const saved = await createArticle({
			data: { ...article, coveringSources: [], coverageVerified: false },
		});

		expect(saved).toMatchObject({ id: 7, coverage_verified: false });
		expect(mocks.txQueryOne).toHaveBeenCalledTimes(2);
	});

	it("rethrows non-schema errors from the coverage write", async () => {
		mocks.txExecute.mockImplementation((_: unknown, sql: string) => {
			if (String(sql).includes("tanah_article_covering_source")) {
				return Promise.reject(new Error("disk full"));
			}
			return Promise.resolve({});
		});

		await expect(
			updateArticle({
				data: {
					...article,
					id: 7,
					coveringSources: [],
					coverageVerified: false,
				},
			}),
		).rejects.toThrow("disk full");
	});

	it("tolerates numeric errno codes for a missing covering schema on delete", async () => {
		mocks.txExecute.mockImplementation((_: unknown, sql: string) => {
			if (String(sql).includes("tanah_article_covering_source")) {
				return Promise.reject(
					Object.assign(new Error("missing"), { errno: 1146 }),
				);
			}
			return Promise.resolve({});
		});

		await expect(deleteArticle({ data: 7 })).resolves.toEqual({
			success: true,
		});
	});

	it("does not degrade a coverage write on a non-object failure", async () => {
		mocks.txExecute.mockImplementation((_: unknown, sql: string) => {
			if (String(sql).includes("tanah_article_covering_source")) {
				return Promise.reject("aborted");
			}
			return Promise.resolve({});
		});

		await expect(deleteArticle({ data: 7 })).rejects.toBe("aborted");
	});

	it("getArticle returns the persisted covering sources", async () => {
		mocks.queryOne.mockResolvedValue({
			id: 7,
			name: "מאמר",
			coverage_verified: true,
		});
		mocks.query.mockResolvedValue([
			{ perek_id: 1, pasuk: 5 },
			{ perek_id: 2, pasuk: 3 },
		]);

		const loaded = await getArticle({ data: 7 });

		expect(loaded.coveringSources).toEqual([
			{ perek_id: 1, pasuk: 5 },
			{ perek_id: 2, pasuk: 3 },
		]);
		expect(loaded.coverage_verified).toBe(true);
	});

	it("getArticle reports coveringSources undefined when the schema is missing", async () => {
		mocks.queryOne.mockResolvedValue({
			id: 7,
			name: "מאמר",
			coverage_verified: false,
		});
		mocks.query.mockRejectedValue(errMissingTable);

		const loaded = await getArticle({ data: 7 });

		expect(loaded.coveringSources).toBeUndefined();
	});

	it("propagates a non-schema failure from the covering-source query", async () => {
		mocks.queryOne.mockResolvedValue({ id: 7, name: "מאמר" });
		mocks.query.mockRejectedValue(new Error("disk full"));

		await expect(getArticle({ data: 7 })).rejects.toThrow("disk full");
	});

	it("propagates a non-schema failure from the covering read-back", async () => {
		mocks.txExecute.mockResolvedValue({});
		mocks.txQueryOne.mockResolvedValue({ id: 7, name: "מאמר" });
		mocks.txQuery.mockRejectedValue(new Error("deadlock"));

		await expect(
			updateArticle({ data: { ...article, id: 7 } }),
		).rejects.toThrow("deadlock");
	});

	it("rejects non-integer covering coordinates before touching the db", async () => {
		await expect(
			updateArticle({
				data: {
					...article,
					id: 7,
					coveringSources: [{ perek_id: 1.5, pasuk: 1 }],
				},
			}),
		).rejects.toThrow("integer perek and pasuk");
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("rejects verified-only coverage on create when nothing is persisted", async () => {
		mocks.txExecute.mockResolvedValue({ insertId: 7 });
		mocks.txQuery.mockImplementation((_: unknown, sql: string) => {
			if (String(sql).includes("COUNT(*)")) {
				return Promise.resolve([{ covering_count: 0 }]);
			}
			return Promise.resolve([]);
		});

		await expect(
			createArticle({ data: { ...article, coverageVerified: true } }),
		).rejects.toThrow("Cannot verify coverage");
	});

	it("coverageVerified:true alone succeeds when rows are already persisted", async () => {
		mocks.txQuery.mockImplementation((_: unknown, sql: string) => {
			if (String(sql).includes("COUNT(*)")) {
				return Promise.resolve([{ covering_count: 2 }]);
			}
			return Promise.resolve([{ perek_id: 1, pasuk: 5 }]);
		});
		mocks.txExecute.mockResolvedValue({});
		mocks.txQueryOne.mockResolvedValue({
			id: 7,
			name: "מאמר",
			coverage_verified: true,
		});

		const saved = await updateArticle({
			data: { ...article, id: 7, coverageVerified: true },
		});

		expect(saved.id).toBe(7);
		const flagUpdate = mocks.txExecute.mock.calls.find(([, sql]) =>
			String(sql).includes("coverage_verified"),
		);
		expect(flagUpdate?.[2]).toEqual([true, 7]);
	});

	it("coverageVerified:true rejects when the count query returns no row", async () => {
		mocks.txQuery.mockImplementation((_: unknown, sql: string) => {
			if (String(sql).includes("COUNT(*)")) {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		});
		mocks.txExecute.mockResolvedValue({});

		await expect(
			updateArticle({ data: { ...article, id: 7, coverageVerified: true } }),
		).rejects.toThrow("no covering sources");
	});
});

describe("cache invalidation hooks", () => {
	it("acknowledges article and perek invalidation requests", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(invalidateArticleCache({ data: 5 })).resolves.toEqual({
			success: true,
		});
		await expect(invalidatePerekCache({ data: 9 })).resolves.toEqual({
			success: true,
		});
		expect(logSpy).toHaveBeenCalledWith("Invalidating cache for article 5");
		expect(logSpy).toHaveBeenCalledWith("Invalidating cache for perek 9");
		logSpy.mockRestore();
	});
});
