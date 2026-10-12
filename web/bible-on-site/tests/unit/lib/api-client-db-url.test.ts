/**
 * Tests for api-client when DB_URL is set (exercises parseDbUrl path).
 * Isolated in a separate file because api-client uses a module-level pool singleton.
 * Uses jest.resetModules + require to get a fresh module instance with DB_URL set.
 */

const mockExecute = jest.fn().mockResolvedValue([[{ id: 42 }]]);

jest.mock("mysql2/promise", () => ({
	createPool: jest.fn().mockReturnValue({
		execute: mockExecute,
	}),
}));

describe("api-client with DB_URL", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		jest.resetModules();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
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
