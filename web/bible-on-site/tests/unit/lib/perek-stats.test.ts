/**
 * @jest-environment node
 */
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import { getPerekStats } from "../../../src/lib/stats";

const mockQuery = query as jest.MockedFunction<typeof query>;

const respond =
	(rabbis: number, articles: number, entries: number) => (sql: string) => {
		if (sql.includes("DISTINCT author_id"))
			return Promise.resolve([{ c: rabbis }]);
		if (sql.includes("tanahpedia_entry"))
			return Promise.resolve([{ c: entries }]);
		return Promise.resolve([{ c: articles }]);
	};

describe("getPerekStats", () => {
	it("counts distinct rabbis, public articles and tanahpedia entries", async () => {
		mockQuery.mockImplementation(respond(3, 4, 17) as never);
		const stats = await getPerekStats();
		expect(stats).toEqual({ rabbis: 3, articles: 4, pediaEntries: 17 });
	});

	it("uses aggregate queries, not row fetching", async () => {
		mockQuery.mockImplementation(respond(1, 1, 1) as never);
		await getPerekStats();
		const calls = mockQuery.mock.calls.map(([sql]) => sql as string);
		expect(calls).toHaveLength(3);
		for (const sql of calls) expect(sql).toMatch(/COUNT\(/);
		expect(calls[0]).toMatch(/COUNT\(DISTINCT author_id\)/);
		expect(calls[1]).toMatch(/FROM tanah_article/);
		expect(calls[2]).toMatch(/FROM tanahpedia_entry/);
	});

	it("applies the public visibility rule (perek range) to article counts", async () => {
		mockQuery.mockImplementation(respond(0, 0, 0) as never);
		await getPerekStats();
		const calls = mockQuery.mock.calls.map(([sql]) => sql as string);
		expect(calls[0]).toMatch(/perek_id BETWEEN 1 AND 929/);
		expect(calls[1]).toMatch(/perek_id BETWEEN 1 AND 929/);
	});

	it("returns a genuine zero rather than treating it as missing data", async () => {
		mockQuery.mockImplementation(respond(0, 0, 0) as never);
		const stats = await getPerekStats();
		expect(stats).toEqual({ rabbis: 0, articles: 0, pediaEntries: 0 });
	});

	it("returns zeros when a count query resolves with no rows", async () => {
		mockQuery.mockResolvedValue([] as never);
		const stats = await getPerekStats();
		expect(stats).toEqual({ rabbis: 0, articles: 0, pediaEntries: 0 });
	});

	it("rejects on database failure instead of presenting a false zero", async () => {
		mockQuery.mockRejectedValue(new Error("db down"));
		await expect(getPerekStats()).rejects.toThrow("db down");
	});

	it("rejects and logs a non-Error failure as-is", async () => {
		mockQuery.mockRejectedValue("plain failure" as never);
		await expect(getPerekStats()).rejects.toBe("plain failure");
	});
});
