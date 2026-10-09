import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execute: vi.fn(),
	queryOne: vi.fn(),
	query: vi.fn(),
}));
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

import { createArticle, getArticle, updateArticle } from "~/server/articles";

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
		for (const mock of Object.values(mocks)) mock.mockReset();
		mocks.execute.mockResolvedValue({ insertId: 7 });
		mocks.queryOne.mockResolvedValue({ ...article, id: 7 });
	});
	it("saves an explicit approval and returns it when reading the article", async () => {
		const created = await createArticle({ data: article });
		expect(created.distributable).toBe(true);
		expect(mocks.execute.mock.calls[0][1]).toContain(true);
		expect(await getArticle({ data: 7 })).toEqual({ ...article, id: 7 });
		expect(mocks.queryOne.mock.calls[1][0]).toContain("distributable");
	});
	it("persists revocation and requires a boolean approval for old clients", async () => {
		await updateArticle({ data: { ...article, id: 7, distributable: false } });
		expect(mocks.execute.mock.calls[0][1]).toEqual([
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
		expect(mocks.execute.mock.calls[1][1]).toContain(false);
	});
});
