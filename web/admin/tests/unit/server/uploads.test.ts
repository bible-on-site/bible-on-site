import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	settings: vi.fn(),
	setQuota: vi.fn(),
	query: vi.fn(),
	execute: vi.fn(),
	txQuery: vi.fn(),
	txExecute: vi.fn(),
	transaction: vi.fn(async (fn) => fn("connection")),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/db", () => mocks);
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		handler: (fn: unknown) => fn,
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				async ({ data }: { data: unknown }) =>
					fn({ data: validate(data) }),
		}),
	}),
}));

import { getUploadSettings, setUploadQuota } from "~/server/uploads";
import { uploadStore } from "~/server/uploads-store.server";

beforeEach(() => {
	vi.spyOn(uploadStore, "settings").mockImplementation(mocks.settings);
	vi.spyOn(uploadStore, "setQuota").mockImplementation(mocks.setQuota);
});
it("reads settings and validates quota units", async () => {
	mocks.settings.mockResolvedValue({ quota: 1000, users: [] });
	expect(await getUploadSettings()).toEqual({ quota: 1000, users: [] });
	await setUploadQuota({ data: { gb: 1000 } });
	expect(mocks.setQuota).toHaveBeenCalledWith(1_000_000_000_000, undefined);
	await setUploadQuota({ data: { gb: null, userId: "user" } });
	expect(mocks.setQuota).toHaveBeenCalledWith(null, "user");
	await expect(setUploadQuota({ data: { gb: -1 } })).rejects.toThrow();
});
it("binds queries to the current transaction connection", async () => {
	mocks.txQuery.mockImplementation(async (_conn, sql: string) =>
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
			await tx.execute("test", []);
		},
	);
	expect(mocks.txExecute).toHaveBeenCalledWith("connection", "test", []);
});
