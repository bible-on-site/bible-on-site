import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const conn = { marker: "tx-conn" };
	const txOrder: string[] = [];
	return {
		conn,
		txOrder,
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
	deleteArticle,
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

const ENQUEUE_MATCH = "INSERT INTO article_search_queue";

function enqueueCalls() {
	return mocks.txExecute.mock.calls.filter((c) =>
		(c[1] as string).startsWith(ENQUEUE_MATCH),
	);
}

describe("article search reindex enqueue", () => {
	beforeEach(() => {
		for (const mock of [
			mocks.execute,
			mocks.queryOne,
			mocks.query,
			mocks.txExecute,
			mocks.txQueryOne,
			mocks.transaction,
		])
			mock.mockReset();
		mocks.transaction.mockImplementation(async (fn) => fn(mocks.conn));
		_resetArticleSearchQueueCache();
		mocks.execute.mockResolvedValue({});
		mocks.txExecute.mockResolvedValue({ insertId: 7 });
		mocks.txQueryOne.mockResolvedValue({ ...article, id: 7 });
	});

	it("creates the queue table once and reuses it across writes", async () => {
		await createArticle({ data: article });
		await updateArticle({ data: { ...article, id: 7 } });
		const ensureCalls = mocks.execute.mock.calls.filter((c) =>
			(c[0] as string).includes("CREATE TABLE IF NOT EXISTS article_search_queue"),
		);
		expect(ensureCalls).toHaveLength(1);
	});

	it("enqueues the new article inside the create transaction", async () => {
		await createArticle({ data: article });
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
		const enqueues = enqueueCalls();
		expect(enqueues).toHaveLength(1);
		// Enqueue runs on the transaction connection with the created id.
		expect(enqueues[0][0]).toBe(mocks.conn);
		expect(enqueues[0][2]).toEqual([7]);
		// …and after the INSERT, before commit would happen.
		expect(mocks.txExecute.mock.calls[0][1]).toContain(
			"INSERT INTO tanah_article",
		);
	});

	it("enqueues the updated article inside the update transaction", async () => {
		await updateArticle({ data: { ...article, id: 42 } });
		const enqueues = enqueueCalls();
		expect(enqueues).toHaveLength(1);
		expect(enqueues[0][2]).toEqual([42]);
		expect(mocks.txExecute.mock.calls[0][1]).toContain(
			"UPDATE tanah_article",
		);
	});

	it("enqueues the deleted article id so the worker purges it", async () => {
		await deleteArticle({ data: 9 });
		const statements = mocks.txExecute.mock.calls.map((c) => c[1] as string);
		expect(statements[0]).toContain("DELETE FROM tanah_article");
		const enqueues = enqueueCalls();
		expect(enqueues).toHaveLength(1);
		expect(enqueues[0][2]).toEqual([9]);
	});

	it("rolls back without enqueueing when the update target vanished", async () => {
		mocks.txQueryOne.mockResolvedValue(null);
		await expect(
			updateArticle({ data: { ...article, id: 42 } }),
		).rejects.toThrow("Failed to retrieve updated article");
		expect(enqueueCalls()).toHaveLength(0);
	});

	it("propagates enqueue failure so the write does not silently go unindexed", async () => {
		mocks.txExecute.mockImplementation(async (_conn, sql: string) =>
			sql.startsWith(ENQUEUE_MATCH)
				? Promise.reject(new Error("queue write failed"))
				: Promise.resolve({ insertId: 7 }),
		);
		await expect(createArticle({ data: article })).rejects.toThrow(
			"queue write failed",
		);
	});

	it("retries the table ensure after a failure instead of caching it", async () => {
		mocks.execute
			.mockRejectedValueOnce(new Error("no db"))
			.mockResolvedValue({});
		await expect(createArticle({ data: article })).rejects.toThrow("no db");
		await createArticle({ data: article });
		expect(enqueueCalls()).toHaveLength(1);
	});
});
