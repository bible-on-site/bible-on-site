import { beforeEach, expect, it, vi } from "vitest";
import {
	type ArchiveUser,
	AUTHORS_DIRECTORY,
	ROOT_DIRECTORY,
} from "~/lib/archive";
import { ArchiveStore } from "~/server/archive/store";

const id = "11111111-1111-1111-1111-111111111111",
	other = "22222222-2222-2222-2222-222222222222",
	nested = "33333333-3333-3333-3333-333333333333";
const author: ArchiveUser = {
	id,
	username: "dorad",
	name: "הרב מחבר",
	role: "archiver",
};
const admin: ArchiveUser = { id: other, username: "admin", role: "admin" };
const folders = [
	{ id: ROOT_DIRECTORY, parentId: null, name: "", path: "", ownerId: null },
	{
		id: AUTHORS_DIRECTORY,
		parentId: ROOT_DIRECTORY,
		name: "authors",
		path: "authors/",
		ownerId: null,
	},
	{
		id,
		parentId: AUTHORS_DIRECTORY,
		name: "הרב מחבר",
		path: "authors/הרב מחבר/",
		ownerId: id,
	},
	{
		id: nested,
		parentId: id,
		name: "חומרים",
		path: "authors/הרב מחבר/חומרים/",
		ownerId: id,
	},
	{
		id: other,
		parentId: AUTHORS_DIRECTORY,
		name: "אחר",
		path: "authors/אחר/",
		ownerId: other,
	},
];
const query = vi.fn(),
	execute = vi.fn();
const store = new ArchiveStore({
	query,
	execute,
	transaction: async (fn) => fn({ query, execute }),
});
beforeEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	query.mockImplementation(async (sql: string, args: unknown[] = []) => {
		if (sql.includes("home_directory_id AS homeId")) return [{ homeId: id }];
		if (sql.includes("FROM private_archive_folder WHERE id"))
			return folders.filter((f) => f.id === args[0]);
		if (sql.includes("FROM private_archive_folder WHERE parent_id"))
			return folders.filter(
				(f) => f.parentId === args[0] && f.name === args[1],
			);
		if (sql.includes("quota_bytes AS quota FROM private_upload_settings"))
			return [{ quota: 100 }];
		if (sql.includes("quota_bytes AS quota FROM private_upload_account"))
			return [{ quota: null }];
		if (sql.includes("SUM(size_bytes)")) return [{ allocated: 90 }];
		return [];
	});
});
it("enforces author ownership and the immutable home prefix before listing or creating", async () => {
	expect((await store.scope(author, nested)).folder.id).toBe(nested);
	for (const target of [ROOT_DIRECTORY, AUTHORS_DIRECTORY, other, "../x"])
		await expect(store.scope(author, target)).rejects.toMatchObject({
			status: 404,
		});
	const spoofed = { ...folders[3], path: "authors/אחר/" };
	query
		.mockImplementationOnce(async () => [])
		.mockImplementationOnce(async () => [{ homeId: id }])
		.mockImplementationOnce(async () => [spoofed])
		.mockImplementationOnce(async () => [folders[2]]);
	await expect(store.scope(author, nested)).rejects.toMatchObject({
		status: 404,
	});
});
it("allows an SSO admin to browse the entire root without relying on usernames", async () => {
	expect((await store.scope(admin, ROOT_DIRECTORY)).folder.id).toBe(
		ROOT_DIRECTORY,
	);
	expect((await store.scope(admin, id)).folder.ownerId).toBe(id);
	expect((await store.scope(author)).folder.id).toBe(id);
});
it("creates a stable named home, sanitizes separators and disambiguates collisions", async () => {
	query.mockImplementation(async (sql: string, args: unknown[] = []) => {
		if (sql.includes("home_directory_id AS homeId")) return [{ homeId: null }];
		if (sql.includes("parent_id = ? AND name = ?") && args[1] === "הרבמחבר")
			return [{ id: other }];
		return [];
	});
	await store.home({ ...author, name: " הרב/מחבר\\ " });
	expect(execute).toHaveBeenCalledWith(
		expect.stringContaining("INSERT INTO private_archive_folder"),
		[id, AUTHORS_DIRECTORY, `הרבמחבר (${id})`, `authors/הרבמחבר (${id})/`, id],
	);
	expect(execute).toHaveBeenCalledWith(
		expect.stringContaining("home_directory_id = ?"),
		[id, id],
	);
});
it("keeps existing homes stable after name changes and rejects reserved user IDs", async () => {
	expect(await store.home({ ...author, name: "שם חדש" })).toBe(id);
	expect(
		execute.mock.calls.some(([sql]) =>
			sql.includes("INSERT INTO private_archive_folder"),
		),
	).toBe(false);
	for (const subject of [ROOT_DIRECTORY, AUTHORS_DIRECTORY, "invalid"])
		await expect(store.home({ ...author, id: subject })).rejects.toMatchObject({
			status: 401,
		});
});
it("creates nested folders with inherited ownership and forbids duplicate names", async () => {
	await store.createFolder(admin, nested, "חדש", id);
	expect(execute).toHaveBeenCalledWith(
		expect.stringContaining("INSERT INTO private_archive_folder"),
		[nested, id, "חדש", "authors/הרב מחבר/חדש/", id],
	);
	await expect(
		store.createFolder(admin, nested, "חומרים", id),
	).rejects.toMatchObject({ status: 409 });
	await expect(store.createFolder(author, "invalid", "חדש")).rejects.toThrow();
	await expect(store.createFolder(author, nested, "../חדש")).rejects.toThrow();
});
it("reserves against the folder owner and checks quota before any file insertion", async () => {
	await store.reserve(admin, nested, "file.any", 10, 8, id);
	expect(execute).toHaveBeenCalledWith(
		expect.stringContaining("INSERT INTO private_upload_file"),
		[nested, id, id, "authors/הרב מחבר/file.any", "file.any", 10, 8],
	);
	execute.mockClear();
	await expect(
		store.reserve(admin, nested, "large", 11, 8, id),
	).rejects.toMatchObject({ status: 413 });
	expect(
		execute.mock.calls.some(([sql]) =>
			sql.includes("INSERT INTO private_upload_file"),
		),
	).toBe(false);
	await expect(store.reserve(admin, "bad", "file", 1, 8)).rejects.toThrow();
});
it("resolves paths through parent names and rejects cross-author, missing and traversal paths", async () => {
	expect(await store.resolvePath(author, "/authors/הרב מחבר/חומרים/")).toBe(
		nested,
	);
	expect(await store.resolvePath(admin, "/")).toBe(ROOT_DIRECTORY);
	for (const path of [
		"/",
		"/authors/אחר",
		"authors/הרב מחבר",
		"/authors/הרב מחבר/missing",
		"/authors/הרב מחבר/..",
	])
		await expect(store.resolvePath(author, path)).rejects.toThrow();
});
it("rechecks file ownership under the owner's quota lock", async () => {
	query.mockImplementation(async (sql: string) => {
		if (sql.includes("FROM private_upload_file WHERE id"))
			return [{ id: nested, ownerId: id, size: 1 }];
		if (sql.includes("SUM(size_bytes)")) return [{ allocated: 1 }];
		return [{ quota: 100 }];
	});
	const change = vi.fn();
	await store.lockedFile(author, nested, change);
	expect(change).toHaveBeenCalledWith(
		expect.any(Object),
		expect.objectContaining({ ownerId: id }),
	);
	expect(
		query.mock.calls.filter(([sql]) =>
			sql.includes("FROM private_upload_file WHERE id"),
		),
	).toHaveLength(2);
});

it.each([
	{ name: undefined, username: "account", expected: "account" },
	{ name: ".", username: "account", expected: "מחבר" },
	{ name: "..", username: "account", expected: "מחבר" },
	{
		name: ` /\\${String.fromCharCode(0, 127, 0xd800)}`,
		username: "account",
		expected: "מחבר",
	},
	{ name: "😀".repeat(110), username: "account", expected: "😀".repeat(100) },
])(
	"creates safe bounded homes for legacy profile names: $username",
	async ({ name, username, expected }) => {
		query.mockImplementation(async (sql: string) =>
			sql.includes("home_directory_id AS homeId") ? [{ homeId: null }] : [],
		);
		await store.home({ ...author, name, username });
		expect(execute).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO private_archive_folder"),
			[id, AUTHORS_DIRECTORY, expected, `authors/${expected}/`, id],
		);
	},
);
it("returns not-found for a missing directory without exposing another home", async () => {
	await expect(
		store.scope(author, "44444444-4444-4444-4444-444444444444"),
	).rejects.toMatchObject({ status: 404 });
});
it("bounds URL depth and length before walking directory names", async () => {
	await expect(
		store.resolvePath(admin, `/${"x/".repeat(128)}`),
	).rejects.toThrow("התיקייה לא נמצאה");
	await expect(
		store.resolvePath(admin, `/${"x".repeat(2049)}`),
	).rejects.toMatchObject({ status: 404 });
});
it("rejects folder nesting beyond the supported depth before insertion", async () => {
	vi.spyOn(store, "scope").mockResolvedValue({
		folder: { ...folders[2], path: "x/".repeat(127) },
		homeId: id,
		ownerId: id,
	});
	await expect(store.createFolder(author, nested, "extra")).rejects.toThrow(
		"עומק התיקיות גדול מדי",
	);
	expect(execute).not.toHaveBeenCalled();
});
it("builds author breadcrumbs up to home and lets admins list root", async () => {
	const page = await store.directory({ ...author, name: undefined }, nested);
	expect(page.breadcrumbs).toEqual([
		{ id, name: "הרב מחבר" },
		{ id: nested, name: "חומרים" },
	]);
	expect(page.username).toBe(author.username);
	const root = await store.directory(admin);
	expect(root.breadcrumbs).toEqual([{ id: ROOT_DIRECTORY, name: "/" }]);
	expect(root).toMatchObject({
		isAdmin: true,
		path: "/",
		username: "admin",
		quotaName: "admin",
	});
});
it("rejects broken and cyclic ancestry instead of leaking parent navigation", async () => {
	const broken = { ...folders[3], parentId: null };
	const scope = vi
		.spyOn(store, "scope")
		.mockResolvedValue({ folder: broken, homeId: id, ownerId: id });
	await expect(store.directory(author, nested)).rejects.toMatchObject({
		status: 404,
	});
	const cyclic = { ...folders[3], parentId: nested };
	scope.mockResolvedValue({ folder: cyclic, homeId: id, ownerId: id });
	const normal = query.getMockImplementation();
	query.mockImplementation(async (sql: string, args: unknown[] = []) =>
		sql.includes("FROM private_archive_folder WHERE id")
			? [cyclic]
			: normal?.(sql, args),
	);
	await expect(store.directory(author, nested)).rejects.toThrow(
		"עומק התיקיות גדול מדי",
	);
});
it("grants only a verified admin the file-owner override", async () => {
	query.mockResolvedValueOnce([{ id: nested, ownerId: id, size: "0" }]);
	expect(await store.readFile(admin, nested)).toMatchObject({
		ownerId: id,
		size: 0,
	});
	expect(query).toHaveBeenCalledWith(
		expect.stringContaining("user_id = ? OR ? = 1"),
		[nested, admin.id, 1],
	);
});
it("does not create a folder over an existing file name", async () => {
	const normal = query.getMockImplementation();
	query.mockImplementation(async (sql: string, args: unknown[] = []) =>
		sql.includes("private_upload_file WHERE directory_id")
			? [{ id: nested }]
			: normal?.(sql, args),
	);
	await expect(
		store.createFolder(author, nested, "taken", id),
	).rejects.toMatchObject({ status: 409 });
	expect(
		execute.mock.calls.some(([sql]) =>
			sql.includes("INSERT INTO private_archive_folder"),
		),
	).toBe(false);
});
