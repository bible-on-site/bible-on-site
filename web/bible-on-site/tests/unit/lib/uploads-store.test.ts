/** @jest-environment node */
import { UploadStore } from "../../../../shared/private-upload-store";

const id = "11111111-1111-1111-1111-111111111111";
const fileId = "22222222-2222-2222-2222-222222222222";
const query = jest.fn();
const execute = jest.fn();
const db = {
	query,
	execute,
	transaction: jest.fn(async (fn) => fn({ query, execute })),
};
const store = new UploadStore(db);
beforeEach(() => {
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
it("serializes quota reads and creates an account keyed by immutable subject", async () => {
	expect(
		await store.locked(id, "alice", async (_tx, quota, allocated) => ({
			quota,
			allocated,
		})),
	).toEqual({ quota: 1000, allocated: 300 });
	expect(query.mock.calls[0][0]).toContain("FOR SHARE");
	expect(execute).toHaveBeenCalledWith(
		expect.stringContaining("INSERT INTO private_upload_account"),
		[id, "alice"],
	);
	expect(query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), [
		id,
	]);
});
it("uses overrides including a zero quota and the default fallback", async () => {
	query
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([{ quota: 0 }])
		.mockResolvedValueOnce([{ allocated: 0 }]);
	expect(await store.locked(id, "alice", async (_tx, quota) => quota)).toBe(0);
	query
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([{ quota: null }])
		.mockResolvedValueOnce([{ allocated: 0 }]);
	expect(await store.locked(id, "alice", async (_tx, quota) => quota)).toBe(
		1_000_000_000_000,
	);
});
it("rejects untrusted account IDs before SQL", async () => {
	await expect(
		store.locked("../other", "a", async () => null),
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
	expect(await store.directory(id, "alice")).toMatchObject({
		username: "alice",
		quota: 1000,
		allocated: 300,
		files: [{ size: 300 }],
	});
	expect(query.mock.calls[3][0]).not.toContain("upload_id");
	expect(query.mock.calls[3][1]).toEqual([id]);
});
it("always checks file ownership together with file ID", async () => {
	query.mockResolvedValueOnce([{ id: fileId, size: "1" }]);
	expect(await store.readFile(id, fileId)).toMatchObject({ size: 1 });
	expect(query).toHaveBeenCalledWith(
		expect.stringContaining("user_id = ? AND id = ?"),
		[id, fileId],
	);
	await expect(store.file(db, id, fileId)).rejects.toMatchObject({
		status: 404,
	});
	await expect(store.file(db, id, "../file")).rejects.toMatchObject({
		status: 404,
	});
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
