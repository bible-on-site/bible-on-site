/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/api-client", () => ({
	getDbConfig: () => ({ host: "database" }),
}));
jest.mock("mysql2/promise", () => ({ createPool: jest.fn() }));

import mysql from "mysql2/promise";
import { uploadStore } from "@/lib/uploads/store";

const connection = {
	execute: jest.fn(),
	beginTransaction: jest.fn(),
	commit: jest.fn(),
	rollback: jest.fn(),
	release: jest.fn(),
};
const pool = {
	execute: connection.execute,
	getConnection: jest.fn(async () => connection),
};
beforeEach(() => {
	(mysql.createPool as jest.Mock).mockReturnValue(pool);
	connection.execute.mockImplementation(async (sql: string) => [
		sql.includes("settings")
			? [{ quota: 1000 }]
			: sql.includes("SUM")
				? [{ allocated: 0 }]
				: [{ quota: null }],
	]);
});

it("uses one database connection for quota locking, reservations and metadata", async () => {
	await uploadStore.locked(
		"11111111-1111-1111-1111-111111111111",
		"alice",
		async (tx) => {
			await tx.execute("reservation", []);
		},
	);
	expect(connection.execute).toHaveBeenCalledWith("reservation", []);
	expect(mysql.createPool).toHaveBeenCalledWith({
		host: "database",
		connectionLimit: 3,
		waitForConnections: true,
		queueLimit: 25,
	});
	expect(connection.commit).toHaveBeenCalled();
	expect(connection.release).toHaveBeenCalled();
});

it("rolls back and releases the private connection after commit failure", async () => {
	connection.commit.mockRejectedValueOnce(new Error("commit failed"));
	await expect(uploadStore.setQuota(1000)).rejects.toThrow("commit failed");
	expect(connection.rollback).toHaveBeenCalled();
	expect(connection.release).toHaveBeenCalled();
});
it("uses the private pool for metadata reads too", async () => {
	expect((await uploadStore.settings()).quota).toBe(1000);
	expect(pool.execute).toHaveBeenCalled();
});
