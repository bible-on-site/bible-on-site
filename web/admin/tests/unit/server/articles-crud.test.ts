import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("article write validation", () => {
	beforeEach(() => {
		for (const mock of [
			mocks.execute,
			mocks.queryOne,
			mocks.query,
			mocks.txExecute,
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
