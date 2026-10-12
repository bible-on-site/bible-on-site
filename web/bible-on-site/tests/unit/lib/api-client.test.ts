/**
 * Unit tests for api-client (parseDbUrl, getDbConfig, query).
 * Mocks mysql2/promise so no real DB is used.
 * Single test avoids clearMocks wiping mock state between tests.
 */

jest.mock("mysql2/promise", () => ({
	createPool: jest.fn().mockReturnValue({
		execute: jest.fn().mockResolvedValue([[{ id: 1 }]]),
		on: jest.fn(),
	}),
}));

import mysql from "mysql2/promise";
import { query } from "../../../src/lib/api-client";

const mockCreatePool = mysql.createPool as jest.MockedFunction<
	typeof mysql.createPool
>;

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

	it("query uses pool and default config when DB_URL unset", async () => {
		const result = await query<{ id: number }>(
			"SELECT id FROM t WHERE id = ?",
			[42],
		);
		expect(mockCreatePool).toHaveBeenCalledWith(
			expect.objectContaining({
				host: "127.0.0.1",
				port: 3306,
				user: "root",
				password: "",
				database: "tanah",
			}),
		);
		const pool = mockCreatePool.mock.results[0].value;
		expect(pool.execute).toHaveBeenCalledWith(
			"SELECT id FROM t WHERE id = ?",
			[42],
		);
		expect(result).toEqual([{ id: 1 }]);
	});

	it("raises the session regexp_time_limit on every pooled connection", async () => {
		jest.resetModules();
		process.env = { ...originalEnv };
		delete process.env.DB_URL;

		const mysql2 = require("mysql2/promise");
		const { query: freshQuery } = require("../../../src/lib/api-client");
		await freshQuery("SELECT 1");

		const pool = mysql2.createPool.mock.results[0].value;
		const listener = pool.on.mock.calls.find(
			([event]: [string]) => event === "connection",
		)?.[1];
		expect(listener).toBeDefined();
		// The pool hands the listener the core callback-API connection and
		// FIFO-queues its setup query ahead of any later pool work, so the
		// session budget is raised before search REGEXP_LIKEs run (#2140).
		const connection = { query: jest.fn() };
		listener(connection);
		expect(connection.query).toHaveBeenCalledWith(
			"SET SESSION regexp_time_limit = 16777216",
			expect.any(Function),
		);
	});
});
