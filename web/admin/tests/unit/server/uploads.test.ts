import { expect, it, vi } from "vitest";

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
vi.mock("~/server/archive-store.server", () => ({
	archiveStore: { settings: mocks.settings, setQuota: mocks.setQuota },
}));
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

import { getUploadSettings, setUploadQuota } from "~/server/archive";

it("reads settings and validates quota units", async () => {
	mocks.settings.mockResolvedValue({ quota: 1000, users: [] });
	expect(await getUploadSettings()).toEqual({ quota: 1000, users: [] });
	await setUploadQuota({ data: { gb: 1000 } });
	expect(mocks.setQuota).toHaveBeenCalledWith(1_000_000_000_000, undefined);
	await setUploadQuota({ data: { gb: null, userId: "user" } });
	expect(mocks.setQuota).toHaveBeenCalledWith(null, "user");
	await expect(setUploadQuota({ data: { gb: -1 } })).rejects.toThrow();
});
