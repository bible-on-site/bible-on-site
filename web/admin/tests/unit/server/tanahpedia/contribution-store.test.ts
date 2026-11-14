import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contribution } from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({
	execute: vi.fn(),
	query: vi.fn(),
	one: vi.fn(),
	txExecute: vi.fn(),
	conn: { transaction: "test" },
}));
vi.mock("~/server/db", () => ({
	execute: mocks.execute,
	query: mocks.query,
	txQueryOne: mocks.one,
	txExecute: mocks.txExecute,
	transaction: (fn: (conn: unknown) => unknown) => fn(mocks.conn),
}));
let store: typeof import("~/server/tanahpedia/contribution-store.server");
const item = {
	id: "id",
	number: 3,
	kind: "issue",
	state: "open",
	title: "Title",
	version: 1,
	issueId: null,
	updatedAt: "old",
} as Contribution;
const row = {
	id: "id",
	number: "3",
	kind: "issue",
	state: "open",
	title: "Title",
	version: 1,
	data: JSON.stringify(item),
};

describe("durable contribution storage", () => {
	beforeEach(async () => {
		vi.resetModules();
		for (const mock of [mocks.execute, mocks.query, mocks.one, mocks.txExecute])
			mock.mockReset();
		mocks.execute.mockResolvedValue({});
		store = await import("~/server/tanahpedia/contribution-store.server");
	});
	it("ensures the additive schema once per process even for concurrent callers", async () => {
		await Promise.all([
			store.ensureContributionSchema(),
			store.ensureContributionSchema(),
		]);
		expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining("IF NOT EXISTS"),
		);
		expect(store.CONTRIBUTION_SCHEMA).not.toContain("DROP");
	});
	it("retries schema initialization after an actual failure", async () => {
		mocks.execute.mockRejectedValueOnce(new Error("DB unavailable"));
		await expect(store.ensureContributionSchema()).rejects.toThrow(
			"unavailable",
		);
		await store.ensureContributionSchema();
		expect(mocks.execute).toHaveBeenCalledTimes(2);
	});
	it("reads JSON stored as a string and uses authoritative scalar columns", async () => {
		mocks.one.mockResolvedValue(row);
		expect(
			await store.readContribution(mocks.conn as never, "id"),
		).toMatchObject({ number: 3, version: 1, title: "Title" });
		expect(mocks.one.mock.calls[0][1]).not.toContain("FOR UPDATE");
	});
	it("locks a requested contribution and decodes native JSON objects", async () => {
		mocks.one.mockResolvedValue({ ...row, data: { ...item, title: "forged" } });
		expect(
			await store.readContribution(mocks.conn as never, "id", true),
		).toMatchObject({ title: "Title" });
		expect(mocks.one.mock.calls[0][1]).toContain("FOR UPDATE");
	});
	it("reports a missing item", async () => {
		mocks.one.mockResolvedValue(null);
		await expect(
			store.readContribution(mocks.conn as never, "missing"),
		).rejects.toThrow("not found");
	});
	it("inserts serialized history and reads the generated discussion number", async () => {
		mocks.one.mockResolvedValue(row);
		await expect(
			store.insertContribution(mocks.conn as never, item),
		).resolves.toMatchObject({ number: 3 });
		expect(mocks.txExecute.mock.calls[0][2]).toEqual([
			"id",
			"issue",
			"open",
			"Title",
			null,
			1,
			JSON.stringify(item),
		]);
	});
	it("increments the version with a compare-and-set update", async () => {
		mocks.txExecute.mockResolvedValue({ affectedRows: 1 });
		const saved = await store.saveContribution(mocks.conn as never, {
			...item,
		});
		expect(saved.version).toBe(2);
		expect(saved.updatedAt).not.toBe("old");
		expect(mocks.txExecute.mock.calls[0][2].slice(-2)).toEqual(["id", 1]);
	});
	it("rejects a lost compare-and-set update", async () => {
		mocks.txExecute.mockResolvedValue({ affectedRows: 0 });
		await expect(
			store.saveContribution(mocks.conn as never, { ...item }),
		).rejects.toThrow("Reload");
	});
	it("lists newest discussions after schema initialization", async () => {
		mocks.query
			.mockResolvedValueOnce([{ open: 2, closed: 0, all: 2 }])
			.mockResolvedValueOnce([{ issues: 2, prs: 0 }])
			.mockResolvedValueOnce([row, { ...row, id: "other", data: { ...item } }]);
		expect((await store.listContributions()).items).toHaveLength(2);
		expect(mocks.query.mock.calls[2][0]).toContain("ORDER BY number DESC");
	});
	it("runs a contribution operation inside a dedicated transaction", async () => {
		const work = vi.fn().mockResolvedValue("result");
		expect(await store.withContributions(work)).toBe("result");
		expect(work).toHaveBeenCalledWith(mocks.conn);
	});
	it("applies bound filters before the page limit and keeps counts independent of the cursor", async () => {
		mocks.query
			.mockResolvedValueOnce([{ open: "501", closed: "3", all: "504" }])
			.mockResolvedValueOnce([{ issues: "600", prs: "20" }])
			.mockResolvedValueOnce(
				Array.from({ length: 101 }, (_, index) => ({
					...row,
					number: 600 - index,
				})),
			);
		const page = await store.listContributions({
			kind: "issue",
			state: "closed",
			assignee: "local_llm",
			q: "literal_%'",
			before: 700,
			relatedTo: "00000000-0000-4000-8000-000000000001",
		});
		expect(page.items).toHaveLength(100);
		expect(page.nextCursor).toBe(501);
		expect(page.counts).toEqual({
			issues: 600,
			prs: 20,
			open: 501,
			closed: 3,
			all: 504,
		});
		expect(mocks.query.mock.calls[2][0]).toContain("state <> 'open'");
		expect(mocks.query.mock.calls[2][0]).toContain("number < ?");
		expect(mocks.query.mock.calls[2][0]).not.toContain("literal_%'");
		expect(mocks.query.mock.calls[2][1]).toContain("literal_%'");
		expect(mocks.query.mock.calls[0][0]).not.toContain("number < ?");
	});
});
