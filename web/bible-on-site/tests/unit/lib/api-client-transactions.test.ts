import mysql, { type PoolConnection } from "mysql2/promise";
import {
	execute,
	queryText,
	transaction,
	txExecute,
	txQuery,
	txQueryOne,
} from "@/lib/api-client";

jest.mock("mysql2/promise", () => ({
	createPool: jest.fn().mockReturnValue({
		execute: jest.fn(),
		query: jest.fn(),
		getConnection: jest.fn(),
	}),
}));

const pool = (mysql.createPool as jest.Mock)() as {
	execute: jest.Mock;
	query: jest.Mock;
	getConnection: jest.Mock;
};

describe("database writes and transaction connections", () => {
	let connection: {
		execute: jest.Mock;
		beginTransaction: jest.Mock;
		commit: jest.Mock;
		rollback: jest.Mock;
		release: jest.Mock;
	};
	let driverConnection: PoolConnection;

	beforeEach(() => {
		connection = {
			execute: jest.fn(),
			beginTransaction: jest.fn().mockResolvedValue(undefined),
			commit: jest.fn().mockResolvedValue(undefined),
			rollback: jest.fn().mockResolvedValue(undefined),
			release: jest.fn(),
		};
		driverConnection = connection as unknown as PoolConnection;
		pool.execute.mockReset();
		pool.query.mockReset();
		pool.getConnection.mockReset().mockResolvedValue(driverConnection);
	});

	it("commits work on one acquired connection and releases it after commit", async () => {
		const saved = { id: 42 };
		connection.execute
			.mockResolvedValueOnce([{ affectedRows: 1, insertId: 42 }])
			.mockResolvedValueOnce([[saved]]);
		const work = jest.fn(async (conn: PoolConnection) => {
			await txExecute(conn, "INSERT INTO entries (id) VALUES (?)", [42]);
			return txQueryOne(conn, "SELECT id FROM entries WHERE id = ?", [42]);
		});

		await expect(transaction(work)).resolves.toBe(saved);
		expect(work).toHaveBeenCalledWith(driverConnection);
		expect(pool.getConnection).toHaveBeenCalledTimes(1);
		expect(pool.execute).not.toHaveBeenCalled();
		expect(connection.execute.mock.calls).toEqual([
			["INSERT INTO entries (id) VALUES (?)", [42]],
			["SELECT id FROM entries WHERE id = ?", [42]],
		]);
		expect(
			connection.beginTransaction.mock.invocationCallOrder[0],
		).toBeLessThan(work.mock.invocationCallOrder[0]);
		expect(work.mock.invocationCallOrder[0]).toBeLessThan(
			connection.commit.mock.invocationCallOrder[0],
		);
		expect(connection.commit.mock.invocationCallOrder[0]).toBeLessThan(
			connection.release.mock.invocationCallOrder[0],
		);
		expect(connection.rollback).not.toHaveBeenCalled();
		expect(connection.release).toHaveBeenCalledTimes(1);
	});

	it("rolls back failed work, preserves its error and releases the connection", async () => {
		const failure = new Error("write failed");
		await expect(
			transaction(async () => {
				throw failure;
			}),
		).rejects.toBe(failure);
		expect(connection.commit).not.toHaveBeenCalled();
		expect(connection.rollback).toHaveBeenCalledTimes(1);
		expect(connection.rollback.mock.invocationCallOrder[0]).toBeLessThan(
			connection.release.mock.invocationCallOrder[0],
		);
		expect(connection.release).toHaveBeenCalledTimes(1);
	});

	it.each(["beginTransaction", "commit"] as const)(
		"rolls back and releases after a %s failure",
		async (operation) => {
			const failure = new Error(`${operation} failed`);
			connection[operation].mockRejectedValueOnce(failure);
			const work = jest.fn().mockResolvedValue("saved");
			await expect(transaction(work)).rejects.toBe(failure);
			expect(work).toHaveBeenCalledTimes(operation === "commit" ? 1 : 0);
			expect(connection.rollback).toHaveBeenCalledTimes(1);
			expect(connection.release).toHaveBeenCalledTimes(1);
		},
	);

	it("does not start work when acquiring a connection fails", async () => {
		const failure = new Error("pool unavailable");
		pool.getConnection.mockRejectedValueOnce(failure);
		const work = jest.fn();
		await expect(transaction(work)).rejects.toBe(failure);
		expect(work).not.toHaveBeenCalled();
		expect(connection.beginTransaction).not.toHaveBeenCalled();
		expect(connection.release).not.toHaveBeenCalled();
	});

	it.each([{ params: undefined }, { params: [42] }])(
		"binds write values and returns the driver header (%j)",
		async ({ params }) => {
			const result = { affectedRows: 1, insertId: 42 };
			pool.execute.mockResolvedValue([result]);
			connection.execute.mockResolvedValue([result]);
			const sql = "INSERT INTO entries (id) VALUES (?)";
			await expect(execute(sql, params)).resolves.toBe(result);
			await expect(txExecute(driverConnection, sql, params)).resolves.toBe(
				result,
			);
			expect(pool.execute).toHaveBeenCalledWith(sql, params ?? []);
			expect(connection.execute).toHaveBeenCalledWith(sql, params ?? []);
		},
	);

	it("uses an empty binding list for transaction reads and returns null for no row", async () => {
		const rows = [{ id: 42 }];
		connection.execute
			.mockResolvedValueOnce([rows])
			.mockResolvedValueOnce([[]]);
		await expect(
			txQuery(driverConnection, "SELECT id FROM entries"),
		).resolves.toBe(rows);
		await expect(
			txQueryOne(driverConnection, "SELECT id FROM entries"),
		).resolves.toBeNull();
		expect(connection.execute).toHaveBeenNthCalledWith(
			1,
			"SELECT id FROM entries",
			[],
		);
		expect(connection.execute).toHaveBeenNthCalledWith(
			2,
			"SELECT id FROM entries",
			[],
		);
	});

	it("uses empty bindings for a text-protocol query without parameters", async () => {
		const rows = [{ id: 42 }];
		pool.query.mockResolvedValue([rows]);
		await expect(queryText("SELECT id FROM entries")).resolves.toBe(rows);
		expect(pool.query).toHaveBeenCalledWith("SELECT id FROM entries", []);
	});
});
