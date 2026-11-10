import { beforeEach, expect, it, type Mock, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/db-config", () => ({
	resolveMysqlUrl: () => "mysql://root:test@database/archive?ssl-mode=DISABLED",
}));
vi.mock("mysql2/promise", () => ({ default: { createPool: vi.fn() } }));

import mysql from "mysql2/promise";
import { archiveStore } from "~/server/archive/database";

const connection = {
	execute: vi.fn(),
	beginTransaction: vi.fn(),
	commit: vi.fn(),
	rollback: vi.fn(),
	release: vi.fn(),
};
const pool = {
	execute: connection.execute,
	getConnection: vi.fn(async () => connection),
};
beforeEach(() => {
	vi.clearAllMocks();
	(mysql.createPool as Mock).mockReturnValue(pool);
	connection.execute.mockImplementation(async (sql: string) => [
		sql.includes("settings")
			? [{ quota: 1000 }]
			: sql.includes("SUM")
				? [{ allocated: 0 }]
				: [{ quota: null }],
	]);
});

it("uses one database connection for quota locking, reservations and metadata", async () => {
	await archiveStore.locked(
		"11111111-1111-1111-1111-111111111111",
		async (tx) => {
			await tx.execute("reservation", []);
		},
	);
	expect(connection.execute).toHaveBeenCalledWith("reservation", []);
	expect(mysql.createPool).toHaveBeenCalledWith({
		uri: "mysql://root:test@database/archive?ssl-mode=DISABLED",
		ssl: undefined,
		connectionLimit: 3,
		waitForConnections: true,
		queueLimit: 25,
	});
	expect(connection.commit).toHaveBeenCalled();
	expect(connection.release).toHaveBeenCalled();
});

it("rolls back and releases the private connection after commit failure", async () => {
	connection.commit.mockRejectedValueOnce(new Error("commit failed"));
	await expect(archiveStore.setQuota(1000)).rejects.toThrow("commit failed");
	expect(connection.rollback).toHaveBeenCalled();
	expect(connection.release).toHaveBeenCalled();
});
it("uses the private pool for metadata reads too", async () => {
	expect((await archiveStore.settings()).quota).toBe(1000);
	expect(pool.execute).toHaveBeenCalled();
});
