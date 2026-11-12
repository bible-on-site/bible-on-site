import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArchiveStore } from "~/server/archive/store";

const id = "11111111-1111-1111-1111-111111111111";
const fileId = "22222222-2222-2222-2222-222222222222";
const user = { id, username: "alice", name: "מחבר א" };
const folder = {
	id,
	parentId: null,
	name: "מחבר א",
	path: "authors/מחבר א/",
	ownerId: id,
};
const query = vi.fn();
const execute = vi.fn();
const db = {
	query,
	execute,
	transaction: vi.fn(async (fn) => fn({ query, execute })),
};
const store = new ArchiveStore(db);
beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(store, "scope").mockResolvedValue({
		folder,
		homeId: id,
		ownerId: id,
	});
	query.mockImplementation(async (sql: string) => {
		if (
			sql.includes("SELECT quota_bytes AS quota FROM private_upload_settings")
		)
			return [{ quota: "1000" }];
		if (sql.includes("SELECT quota_bytes AS quota FROM private_upload_account"))
			return [{ quota: null }];
		if (sql.includes("SUM(size_bytes)")) return [{ allocated: "300" }];
		return [];
	});
});
it("serializes quota reads by immutable owner without changing the owner's profile", async () => {
	expect(
		await store.locked(id, async (_tx, quota, allocated) => ({
			quota,
			allocated,
		})),
	).toEqual({ quota: 1000, allocated: 300 });
	expect(query.mock.calls[0][0]).toContain("FOR SHARE");
	expect(execute).not.toHaveBeenCalled();
	expect(query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), [
		id,
	]);
});
it("uses overrides including a zero quota and the default fallback", async () => {
	query
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([{ quota: 0 }])
		.mockResolvedValueOnce([{ allocated: 0 }]);
	expect(await store.locked(id, async (_tx, quota) => quota)).toBe(0);
	query
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([{ quota: null }])
		.mockResolvedValueOnce([{ allocated: 0 }]);
	expect(await store.locked(id, async (_tx, quota) => quota)).toBe(
		1_000_000_000_000,
	);
});
it("rejects untrusted account IDs before SQL", async () => {
	await expect(
		store.locked("../other", async () => null),
	).rejects.toMatchObject({ status: 401 });
	expect(query).not.toHaveBeenCalled();
});
it("returns directory metadata without S3 upload IDs", async () => {
	query
		.mockResolvedValueOnce([{ quota: 1000 }])
		.mockResolvedValueOnce([{ quota: null }])
		.mockResolvedValueOnce([{ allocated: "300" }])
		.mockResolvedValueOnce([
			{ id: fileId, filename: "a", size: "300", status: "ready" },
		]);
	expect(await store.directory(user)).toMatchObject({
		username: "מחבר א",
		quota: 1000,
		allocated: 300,
		files: [{ size: 300 }],
	});
	expect(query.mock.calls[3][0]).not.toContain("upload_id");
	expect(query.mock.calls[3][1]).toEqual([
		id,
		"9999-12-31 23:59:59.999999",
		"9999-12-31 23:59:59.999999",
		"ffffffff-ffff-ffff-ffff-ffffffffffff",
		id,
		"9999-12-31 23:59:59.999999",
		"9999-12-31 23:59:59.999999",
		"ffffffff-ffff-ffff-ffff-ffffffffffff",
	]);
});
it("always checks file ownership together with file ID", async () => {
	query.mockResolvedValueOnce([{ id: fileId, size: "1" }]);
	expect(await store.readFile(user, fileId)).toMatchObject({ size: 1 });
	expect(query).toHaveBeenCalledWith(
		expect.stringContaining("user_id = ? OR ? = 1"),
		[fileId, id, 0],
	);
	await expect(store.file(db, user, fileId)).rejects.toMatchObject({
		status: 404,
	});
	await expect(store.file(db, user, "../file")).rejects.toMatchObject({
		status: 404,
	});
});

it("bounds directory responses and uses a validated cursor for subsequent pages", async () => {
	const time = "2026-11-10 00:00:00.123456";
	const cursor = `${time}|${fileId}`;
	const files = Array.from({ length: 101 }, () => ({
		id: fileId,
		size: "1",
		updatedAt: time,
	}));
	query
		.mockResolvedValueOnce([{ quota: 1000 }])
		.mockResolvedValueOnce([{ quota: null }])
		.mockResolvedValueOnce([{ allocated: 101 }])
		.mockResolvedValueOnce(files);
	const page = await store.directory(user, "", cursor);
	expect(page.files).toHaveLength(100);
	expect(page.nextCursor).toBe(cursor);
	expect(query.mock.calls[3]).toEqual([
		expect.stringContaining("LIMIT 101"),
		[id, time, time, fileId, id, time, time, fileId],
	]);
	await expect(store.directory(user, "", "invalid")).rejects.toThrow();
	for (const invalid of [
		`${time}|invalid`,
		`2026-99-10 00:00:00.123456|${fileId}`,
		`2026-11-10 00:00:00.12345x|${fileId}`,
	])
		await expect(store.directory(user, "", invalid)).rejects.toThrow();
});
it("returns numeric admin settings and fallback defaults", async () => {
	query.mockResolvedValueOnce([{ quota: "1000" }]).mockResolvedValueOnce([
		{ userId: id, username: "alice", quota: null, allocated: "5" },
		{ userId: fileId, username: "bob", quota: "0", allocated: "0" },
	]);
	expect(await store.settings()).toEqual({
		quota: 1000,
		users: [
			{ userId: id, username: "alice", quota: null, allocated: 5 },
			{ userId: fileId, username: "bob", quota: 0, allocated: 0 },
		],
	});
	query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
	expect((await store.settings()).quota).toBe(1_000_000_000_000);
});
it("serializes both default and individual quota edits", async () => {
	await store.setQuota(1000);
	await store.setQuota(0, id);
	await store.setQuota(null, id);
	expect(query.mock.calls[0][0]).toContain("FOR UPDATE");
	expect(execute.mock.calls.map((call) => call[1])).toEqual([
		[1000],
		[0, id],
		[null, id],
	]);
});
it("rejects invalid quotas and subjects", async () => {
	for (const quota of [-1, 1.5, Number.NaN])
		await expect(store.setQuota(quota)).rejects.toThrow();
	await expect(store.setQuota(null)).rejects.toThrow();
	await expect(store.setQuota(1, "other")).rejects.toThrow();
});

afterEach(() => vi.restoreAllMocks());
