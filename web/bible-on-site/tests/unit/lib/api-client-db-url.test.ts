/**
 * Tests for api-client when DB_URL is set (exercises parseDbUrl path).
 * Isolated in a separate file because api-client uses a module-level pool singleton.
 * Uses jest.resetModules + require to get a fresh module instance with DB_URL set.
 */

const mockExecute = jest.fn().mockResolvedValue([[{ id: 42 }]]);
const mockQuery = jest.fn().mockResolvedValue([[{ id: 42 }]]);

jest.mock("mysql2/promise", () => ({
	createPool: jest.fn().mockReturnValue({
		execute: mockExecute,
		query: mockQuery,
	}),
}));

describe("api-client with DB_URL", () => {
	const originalEnv = process.env;
	let warnSpy: jest.SpyInstance;

	beforeEach(() => {
		jest.resetModules();
		process.env = { ...originalEnv };
		warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		process.env = originalEnv;
		warnSpy.mockRestore();
	});

	it("parses DB_URL and creates pool with parsed options", async () => {
		process.env.DB_URL =
			"mysql://myuser:mypass@db.example.com:3307/my_database";

		const mysql = require("mysql2/promise");
		const { query } = require("../../../src/lib/api-client");
		await query("SELECT 1");

		expect(mysql.createPool).toHaveBeenCalledWith(
			expect.objectContaining({
				host: "db.example.com",
				port: 3307,
				user: "myuser",
				password: "mypass",
				database: "my_database",
			}),
		);
	});

	it("defaults to port 3306 when DB_URL has no port", async () => {
		process.env.DB_URL = "mysql://user:pass@host/db";

		const mysql = require("mysql2/promise");
		const { query } = require("../../../src/lib/api-client");
		await query("SELECT 1");

		expect(mysql.createPool).toHaveBeenCalledWith(
			expect.objectContaining({
				host: "host",
				port: 3306,
				user: "user",
				password: "pass",
				database: "db",
			}),
		);
	});

	it.each([
		{
			description: "percent-encoded punctuation",
			url: "mysql://reader%40example:pa%3Ass%2Fword%3F%23%25@db.example.com/bible%20notes%2B2026",
			expected: {
				user: "reader@example",
				password: "pa:ss/word?#%",
				database: "bible notes+2026",
			},
		},
		{
			description: "percent-encoded UTF-8",
			url: "mysql://%D7%A7%D7%95%D7%A8%D7%90:%C3%A9%D7%90%F0%9F%94%91@db.example.com/caf%C3%A9",
			expected: {
				user: "קורא",
				password: "éא🔑",
				database: "café",
			},
		},
		{
			description: "literal plus signs",
			url: "mysql://reader+notes:one+two@db.example.com/bible+notes",
			expected: {
				user: "reader+notes",
				password: "one+two",
				database: "bible+notes",
			},
		},
		{
			description: "legacy malformed percent escapes",
			url: "mysql://reader%GG:pass%2@db.example.com/db%",
			warnings: 3,
			expected: {
				user: "reader%GG",
				password: "pass%2",
				database: "db%",
			},
		},
		{
			description: "percent signs encoded exactly once",
			url: "mysql://reader%252F:pass%252B@db.example.com/db%2520name",
			expected: {
				user: "reader%2F",
				password: "pass%2B",
				database: "db%20name",
			},
		},
	])(
		"parses $description without changing intended database values",
		async ({ url, expected, warnings = 0 }) => {
			process.env.DB_URL = url;

			const mysql = require("mysql2/promise");
			const { query } = require("../../../src/lib/api-client");
			await query("SELECT 1");

			expect(mysql.createPool).toHaveBeenCalledWith(
				expect.objectContaining(expected),
			);
			expect(warnSpy.mock.calls).toEqual(
				Array.from({ length: warnings }, () => [
					"Malformed database URL component; preserving its original value",
				]),
			);
		},
	);

	it("uses default config when DB_URL is unset", async () => {
		delete process.env.DB_URL;

		const mysql = require("mysql2/promise");
		const { query } = require("../../../src/lib/api-client");
		await query("SELECT 1");

		expect(mysql.createPool).toHaveBeenCalledWith(
			expect.objectContaining({
				host: "127.0.0.1",
				port: 3306,
				user: "root",
				password: "",
				database: "tanah",
			}),
		);
	});

	it("preserves raw individual env values when DB_URL is unset", async () => {
		delete process.env.DB_URL;
		Object.assign(process.env, {
			DB_HOST: "db.example.com",
			DB_PORT: "3308",
			DB_USER: "reader%40example",
			DB_PASSWORD: "raw%2B+value",
			DB_NAME: "bible%20notes",
		});

		const mysql = require("mysql2/promise");
		const { queryText } = require("../../../src/lib/api-client");
		await queryText("SELECT 1");

		expect(mysql.createPool).toHaveBeenCalledWith(
			expect.objectContaining({
				host: "db.example.com",
				port: 3308,
				user: "reader%40example",
				password: "raw%2B+value",
				database: "bible%20notes",
			}),
		);
		expect(mockQuery).toHaveBeenCalledWith("SELECT 1", []);
	});

	it("reuses pool on subsequent calls", async () => {
		process.env.DB_URL = "mysql://u:p@h:3306/d";

		const mysql = require("mysql2/promise");
		const { query } = require("../../../src/lib/api-client");
		await query("SELECT 1");
		await query("SELECT 2");

		// Pool should only be created once
		expect(mysql.createPool).toHaveBeenCalledTimes(1);
		// But execute should be called twice
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});
});
