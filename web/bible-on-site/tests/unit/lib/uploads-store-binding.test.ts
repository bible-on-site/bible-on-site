/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/api-client", () => ({
	query: jest.fn(),
	execute: jest.fn(),
	transaction: jest.fn(async (fn) => fn("connection")),
	txQuery: jest.fn(),
	txExecute: jest.fn(),
}));

import { txExecute, txQuery } from "@/lib/api-client";
import { uploadStore } from "@/lib/uploads/store";

it("uses one database connection for quota locking, reservations and metadata", async () => {
	(txQuery as jest.Mock).mockImplementation(async (_conn, sql: string) =>
		sql.includes("settings")
			? [{ quota: 1000 }]
			: sql.includes("SUM")
				? [{ allocated: 0 }]
				: [{ quota: null }],
	);
	await uploadStore.locked(
		"11111111-1111-1111-1111-111111111111",
		"alice",
		async (tx) => {
			await tx.execute("reservation", []);
		},
	);
	expect(txExecute).toHaveBeenCalledWith("connection", "reservation", []);
});
