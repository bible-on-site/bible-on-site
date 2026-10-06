import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, getConnectionMock, createPoolMock, conn } = vi.hoisted(
	() => {
		const conn = {
			execute: vi.fn(),
			beginTransaction: vi.fn(),
			commit: vi.fn(),
			rollback: vi.fn(),
			release: vi.fn(),
		};
		return {
			conn,
			executeMock: vi.fn(),
			getConnectionMock: vi.fn(() => Promise.resolve(conn)),
			createPoolMock: vi.fn(),
		};
	},
);

vi.mock("mysql2/promise", () => ({
	default: {
		createPool: createPoolMock.mockImplementation(() => ({
			execute: executeMock,
			getConnection: getConnectionMock,
		})),
	},
}));

vi.mock("~/server/db-config", () => ({
	resolveMysqlUrl: () =>
		"mysql://user:pass@localhost:3307/testdb?ssl-mode=DISABLED",
}));

import {
	execute,
	query,
	queryOne,
	transaction,
	txExecute,
	txQuery,
	txQueryOne,
} from "~/server/db";

describe("db", () => {
	beforeEach(() => {
		// Keep createPoolMock's import-time call record intact.
		executeMock.mockClear();
		conn.execute.mockClear();
		conn.beginTransaction.mockClear();
		conn.commit.mockClear();
		conn.rollback.mockClear();
		conn.release.mockClear();
	});

	it("builds the pool from the resolved MySQL URL", async () => {
		const { pool } = await import("~/server/db");
		expect(pool).toBeDefined();
	});

	it("query returns the rows from pool.execute", async () => {
		executeMock.mockResolvedValue([[{ id: 1 }], []]);
		expect(await query("SELECT 1", ["a"])).toEqual([{ id: 1 }]);
		expect(executeMock).toHaveBeenCalledWith("SELECT 1", ["a"]);
	});

	it("query defaults params to an empty array", async () => {
		executeMock.mockResolvedValue([[], []]);
		await query("SELECT 1");
		expect(executeMock).toHaveBeenCalledWith("SELECT 1", []);
	});

	it("queryOne returns the first row or null", async () => {
		executeMock.mockResolvedValueOnce([[{ id: 1 }], []]);
		expect(await queryOne("SELECT 1")).toEqual({ id: 1 });
		executeMock.mockResolvedValueOnce([[], []]);
		expect(await queryOne("SELECT 1")).toBeNull();
	});

	it("execute returns the result header", async () => {
		const header = { affectedRows: 2 };
		executeMock.mockResolvedValue([header, []]);
		expect(await execute("UPDATE t")).toBe(header);
	});

	it("transaction commits and releases the connection", async () => {
		const result = await transaction(async (c) => {
			expect(c).toBe(conn);
			return "done";
		});
		expect(result).toBe("done");
		expect(conn.beginTransaction).toHaveBeenCalled();
		expect(conn.commit).toHaveBeenCalled();
		expect(conn.release).toHaveBeenCalled();
	});

	it("transaction rolls back on error and still releases", async () => {
		await expect(
			transaction(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(conn.rollback).toHaveBeenCalled();
		expect(conn.release).toHaveBeenCalled();
	});

	it("txQuery / txQueryOne / txExecute run on the given connection", async () => {
		conn.execute
			.mockResolvedValueOnce([[{ id: 1 }], []])
			.mockResolvedValueOnce([[{ id: 2 }], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
		expect(await txQuery(conn, "SELECT", [1])).toEqual([{ id: 1 }]);
		expect(await txQueryOne(conn, "SELECT")).toEqual({ id: 2 });
		expect(await txExecute(conn, "UPDATE")).toEqual({ affectedRows: 1 });
		expect(conn.execute).toHaveBeenCalledTimes(3);
	});
});
