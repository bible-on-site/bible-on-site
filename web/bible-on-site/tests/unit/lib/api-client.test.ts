/**
 * Unit tests for api-client (parseDbUrl, getDbConfig, query).
 * Mocks mysql2/promise so no real DB is used.
 * Single test avoids clearMocks wiping mock state between tests.
 */

jest.mock("mysql2/promise", () => ({
	createPool: jest.fn().mockReturnValue({
		execute: jest.fn().mockResolvedValue([[{ id: 1 }]]),
		query: jest.fn().mockResolvedValue([[{ id: 2 }]]),
	}),
}));

describe("api-client", () => {
	const originalEnv = process.env;

	afterEach(() => {
		process.env = originalEnv;
	});

	it("uses tanah-dev database in development mode", async () => {
		jest.resetModules();
		process.env = { ...originalEnv, NODE_ENV: "development" };
		delete process.env.DB_URL;

		const mysql2 = require("mysql2/promise");
		const { query: devQuery } = require("../../../src/lib/api-client");
		await devQuery("SELECT 1");

		expect(mysql2.createPool).toHaveBeenCalledWith(
			expect.objectContaining({
				database: "tanah-dev",
			}),
		);
	});

	it("query executes the parameterized statement on the shared pool", async () => {
		// The dev-mode test resets the module registry, so the hoisted import
		// binds an orphaned instance whose coverage counters are discarded —
		// require fresh to hit the live instance (and its mysql2 mock).
		const mysql2 = require("mysql2/promise");
		const { query: liveQuery } = require("../../../src/lib/api-client");
		const result = await liveQuery("SELECT id FROM t WHERE id = ?", [42]);
		const pool = (mysql2.createPool as jest.Mock)() as {
			query: jest.Mock;
			execute: jest.Mock;
		};
		expect(pool.execute).toHaveBeenCalledWith(
			"SELECT id FROM t WHERE id = ?",
			[42],
		);
		expect(result).toEqual([{ id: 1 }]);
	});

	it("queryText runs the text protocol, not a prepared statement", async () => {
		// Search providers depend on the literal-pattern behavior: the
		// server compiles an interpolated REGEXP_LIKE pattern once per
		// statement, while a prepared `REGEXP_LIKE(col, ?)` re-validates
		// the pattern per row on a large scan (#2140).
		// Re-require after the dev-mode test's registry reset for the same
		// coverage-map reason as the query test above.
		const mysql2 = require("mysql2/promise");
		const { queryText: liveQueryText } = require("../../../src/lib/api-client");
		const result = await liveQueryText(
			"SELECT id FROM t WHERE REGEXP_LIKE(c, ?)",
			["א.*ב"],
		);
		// clearMocks wipes mock.results between tests and the module's pool
		// is a singleton, so get the shared mock object by invoking the
		// factory rather than reading a prior call's return value.
		const pool = (mysql2.createPool as jest.Mock)() as {
			query: jest.Mock;
			execute: jest.Mock;
		};
		expect(pool.query).toHaveBeenCalledWith(
			"SELECT id FROM t WHERE REGEXP_LIKE(c, ?)",
			["א.*ב"],
		);
		expect(pool.execute).not.toHaveBeenCalledWith(
			"SELECT id FROM t WHERE REGEXP_LIKE(c, ?)",
			expect.anything(),
		);
		expect(result).toEqual([{ id: 2 }]);
	});
});
