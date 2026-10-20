/**
 * @jest-environment node
 */
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));


import { query } from "../../../src/lib/api-client";
import { getPerekStats } from "../../../src/lib/stats";

const mockQuery = query as jest.MockedFunction<typeof query>;

const respond = (articles: number, entries: number) => (sql: string) => {
	if (sql.includes("tanahpedia_entry"))
		return Promise.resolve([{ c: entries }]);
	return Promise.resolve([{ c: articles }]);
};

describe("getPerekStats", () => {
	it("counts articles, meaningful tanahpedia entries, recorded perakim and programme years", async () => {
		mockQuery.mockImplementation(respond(4, 17) as never);
		const stats = await getPerekStats();
		expect(stats.articles).toBe(4);
		expect(stats.pediaEntries).toBe(17);
		expect(stats.recordedPerakim).toBeGreaterThan(0);
		expect(stats.programmeYears).toBeGreaterThan(0);
		expect(stats).not.toHaveProperty("rabbis");
	});

	it("uses aggregate queries, not row fetching", async () => {
		mockQuery.mockImplementation(respond(1, 1) as never);
		await getPerekStats();
		const calls = mockQuery.mock.calls.map(([sql]) => sql as string);
		expect(calls).toHaveLength(2);
		for (const sql of calls) expect(sql).toMatch(/COUNT\(/);
		expect(calls[0]).toMatch(/FROM tanah_article/);
		expect(calls[1]).toMatch(/FROM tanahpedia_entry/);
	});

	it("applies the public visibility rule (perek range) to article counts", async () => {
		mockQuery.mockImplementation(respond(0, 0) as never);
		await getPerekStats();
		const calls = mockQuery.mock.calls.map(([sql]) => sql as string);
		expect(calls[0]).toMatch(/perek_id BETWEEN 1 AND 929/);
	});

	it("excludes tanahpedia rows with null, empty or markup-only content", async () => {
		mockQuery.mockImplementation(respond(0, 0) as never);
		await getPerekStats();
		const sql = mockQuery.mock.calls.map(([s]) => s as string)[1];
		// The predicate must strip HTML markup and entity/nbsp whitespace, then
		// require remaining visible text — not just a non-null content column.
		expect(sql).toMatch(/REGEXP_REPLACE\(content,\s*'<\[\^>\]\+>'/);
		expect(sql).toMatch(/&nbsp;/);
		expect(sql).toMatch(/&#160;/);
		expect(sql).toMatch(/CHAR\(0xC2A0 USING utf8mb4\)/);
		expect(sql).toMatch(/CHAR_LENGTH\(REGEXP_REPLACE/);
		expect(sql).toMatch(/> 0/);
		// Exact-string body checks must not count a row by its mere existence.
		expect(sql).not.toMatch(/COUNT\(\*\) AS c FROM tanahpedia_entry\s*$/);
	});

	it("runs no author aggregation — the rabbi counter is a fixed word", async () => {
		mockQuery.mockImplementation(respond(0, 0) as never);
		await getPerekStats();
		const calls = mockQuery.mock.calls.map(([sql]) => sql as string);
		expect(calls.some((sql) => sql.includes("author_id"))).toBe(false);
	});

	it("returns a genuine zero rather than treating it as missing data", async () => {
		mockQuery.mockImplementation(respond(0, 0) as never);
		const stats = await getPerekStats();
		expect(stats.articles).toBe(0);
		expect(stats.pediaEntries).toBe(0);
	});

	it("returns zeros when a count query resolves with no rows", async () => {
		mockQuery.mockResolvedValue([] as never);
		const stats = await getPerekStats();
		expect(stats.articles).toBe(0);
		expect(stats.pediaEntries).toBe(0);
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
