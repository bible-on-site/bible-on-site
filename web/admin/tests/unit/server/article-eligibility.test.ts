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
		// transaction() runs the callback on the fake pooled connection.
		transaction: vi.fn((fn: (c: typeof conn) => unknown) => fn(conn)),
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
describe("article distribution eligibility", () => {
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
		mocks.execute.mockResolvedValue({ insertId: 0 });
		mocks.txExecute.mockResolvedValue({ insertId: 7 });
		mocks.txQueryOne.mockResolvedValue({ ...article, id: 7 });
		mocks.queryOne.mockResolvedValue({ ...article, id: 7 });
	});
	it("saves an explicit approval and returns it when reading the article", async () => {
		const created = await createArticle({ data: article });
		expect(created.distributable).toBe(true);
		// First tx write is the INSERT; approval flag travels in its params.
		expect(mocks.txExecute.mock.calls[0][2]).toContain(true);
		expect(await getArticle({ data: 7 })).toEqual({ ...article, id: 7 });
		expect(mocks.queryOne.mock.calls[0][0]).toContain("distributable");
	});
	it("persists revocation and requires a boolean approval for old clients", async () => {
		await updateArticle({ data: { ...article, id: 7, distributable: false } });
		expect(mocks.txExecute.mock.calls[0][2]).toEqual([
			1,
			2,
			null,
			"מאמר",
			1,
			false,
			"<p>תוכן</p>",
			7,
		]);
		await createArticle({
			data: { ...article, distributable: undefined as unknown as boolean },
		});
		// The second create's INSERT params carry the coerced false.
		const createCalls = mocks.txExecute.mock.calls.filter((c) =>
			(c[1] as string).startsWith("INSERT INTO tanah_article"),
		);
		expect(createCalls.at(-1)?.[2]).toContain(false);
	});
});
