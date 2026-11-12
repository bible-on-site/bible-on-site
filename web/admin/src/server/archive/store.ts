import {
	type ArchiveUser,
	AUTHORS_DIRECTORY,
	DEFAULT_QUOTA,
	type Directory,
	isUploadId,
	objectKey,
	ROOT_DIRECTORY,
	UploadError,
	type UploadFile,
	validateFile,
} from "../../lib/archive";

export interface Sql {
	query<T>(sql: string, params?: unknown[]): Promise<T[]>;
	execute(sql: string, params?: unknown[]): Promise<unknown>;
}
export interface UploadDatabase extends Sql {
	transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}
interface Account {
	quota: number | null;
	homeId: string | null;
}
interface Folder {
	id: string;
	parentId: string | null;
	name: string;
	path: string;
	ownerId: string | null;
}
function authorName(user: ArchiveUser) {
	let name = "";
	for (const character of Array.from(user.name || user.username).slice(
		0,
		200,
	)) {
		const code = character.codePointAt(0) as number;
		if (
			code >= 32 &&
			code !== 127 &&
			!(code >= 0xd800 && code <= 0xdfff) &&
			character !== "/" &&
			character !== "\\" &&
			name.length + character.length <= 200
		)
			name += character;
	}
	name = name.trim();
	return !name || name === "." || name === ".." ? "מחבר" : name;
}

function directoryCursor(after: string) {
	if (!after)
		return {
			time: "9999-12-31 23:59:59.999999",
			id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
		};
	const time = after.slice(0, 26);
	const id = after.slice(27);
	if (after.length !== 63 || after[26] !== "|" || !isUploadId(id))
		throw new UploadError("מיקום תיקייה אינו תקין");
	const date = new Date(`${time.slice(0, 10)}T${time.slice(11, 23)}Z`);
	if (
		!Number.isFinite(date.valueOf()) ||
		date.toISOString().slice(0, 23).replace("T", " ") !== time.slice(0, 23)
	)
		throw new UploadError("מיקום תיקייה אינו תקין");
	for (let index = 23; index < 26; index++) {
		const code = time.charCodeAt(index);
		if (code < 48 || code > 57) throw new UploadError("מיקום תיקייה אינו תקין");
	}
	return { time, id };
}

export class ArchiveStore {
	constructor(private db: UploadDatabase) {}

	async home(user: ArchiveUser) {
		if (
			!isUploadId(user.id) ||
			user.id === ROOT_DIRECTORY ||
			user.id === AUTHORS_DIRECTORY
		)
			throw new UploadError("מזהה משתמש אינו תקין", 401);
		return this.db.transaction(async (tx) => {
			await tx.query(
				"SELECT id FROM private_upload_settings WHERE id = 1 FOR SHARE",
			);
			await tx.execute(
				"INSERT INTO private_upload_account (user_id, username, account_kind) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username), account_kind = VALUES(account_kind)",
				[user.id, user.username, user.role === "admin" ? "admin" : "author"],
			);
			const [account] = await tx.query<Account>(
				"SELECT home_directory_id AS homeId FROM private_upload_account WHERE user_id = ? FOR UPDATE",
				[user.id],
			);
			if (user.role === "admin") return ROOT_DIRECTORY;
			if (account.homeId) return account.homeId;
			await tx.query(
				"SELECT id FROM private_archive_folder WHERE id = ? FOR UPDATE",
				[AUTHORS_DIRECTORY],
			);
			let name = authorName(user);
			if (await this.nameExists(tx, AUTHORS_DIRECTORY, name))
				name += ` (${user.id})`;
			await this.availableName(tx, AUTHORS_DIRECTORY, name);
			await tx.execute(
				"INSERT INTO private_archive_folder (id, parent_id, name, path, owner_id) VALUES (?, ?, ?, ?, ?)",
				[user.id, AUTHORS_DIRECTORY, name, `authors/${name}/`, user.id],
			);
			await tx.execute(
				"UPDATE private_upload_account SET home_directory_id = ? WHERE user_id = ?",
				[user.id, user.id],
			);
			return user.id;
		});
	}

	private async folder(tx: Sql, id: string, lock = false) {
		if (!isUploadId(id)) throw new UploadError("התיקייה לא נמצאה", 404);
		const [folder] = await tx.query<Folder>(
			lock
				? "SELECT id, parent_id AS parentId, name, path, owner_id AS ownerId FROM private_archive_folder WHERE id = ? FOR UPDATE"
				: "SELECT id, parent_id AS parentId, name, path, owner_id AS ownerId FROM private_archive_folder WHERE id = ?",
			[id],
		);
		if (!folder) throw new UploadError("התיקייה לא נמצאה", 404);
		return folder;
	}

	async scope(user: ArchiveUser, directoryId = "") {
		const homeId = await this.home(user);
		const folder = await this.folder(this.db, directoryId || homeId);
		if (user.role !== "admin") {
			const home = await this.folder(this.db, homeId);
			if (folder.ownerId !== user.id || !folder.path.startsWith(home.path))
				throw new UploadError("התיקייה לא נמצאה", 404);
		}
		return { folder, homeId, ownerId: folder.ownerId || user.id };
	}

	/** Resolve human-readable archive URLs through the indexed parent/name key. */
	async resolvePath(user: ArchiveUser, path: string) {
		const homeId = await this.home(user);
		const home = await this.folder(this.db, homeId);
		if (!path.startsWith("/") || path.length > 2048)
			throw new UploadError("התיקייה לא נמצאה", 404);
		const relative = path.slice(1).replace(/\/$/, "");
		const base = user.role === "admin" ? "" : home.path.slice(0, -1);
		if (base && relative !== base && !relative.startsWith(`${base}/`))
			throw new UploadError("התיקייה לא נמצאה", 404);
		const remainder = base
			? relative.slice(base.length).replace(/^\//, "")
			: relative;
		const segments = remainder ? remainder.split("/") : [];
		if (segments.length > 127) throw new UploadError("התיקייה לא נמצאה", 404);
		let id = homeId;
		for (const segment of segments) {
			validateFile(segment, 0);
			const [child] = await this.db.query<{ id: string }>(
				"SELECT id FROM private_archive_folder WHERE parent_id = ? AND name = ?",
				[id, segment],
			);
			if (!child) throw new UploadError("התיקייה לא נמצאה", 404);
			id = child.id;
		}
		return (await this.scope(user, id)).folder.id;
	}

	private async nameExists(tx: Sql, directoryId: string, name: string) {
		const folders = await tx.query(
			"SELECT id FROM private_archive_folder WHERE parent_id = ? AND name = ? LIMIT 1 FOR SHARE",
			[directoryId, name],
		);
		const files = await tx.query(
			"SELECT id FROM private_upload_file WHERE directory_id = ? AND filename = ? LIMIT 1 FOR SHARE",
			[directoryId, name],
		);
		return folders.length > 0 || files.length > 0;
	}

	private async availableName(tx: Sql, directoryId: string, name: string) {
		if (await this.nameExists(tx, directoryId, name))
			throw new UploadError("כבר קיים קובץ או תיקייה בשם זה", 409);
	}

	async createFolder(
		user: ArchiveUser,
		id: string,
		name: unknown,
		parentId = "",
	) {
		const validated = validateFile(name, 0);
		if (!isUploadId(id)) throw new UploadError("מזהה תיקייה אינו תקין");
		const scope = await this.scope(user, parentId);
		const path = `${scope.folder.path}${validated.filename}/`;
		if (path.split("/").length > 128)
			throw new UploadError("עומק התיקיות גדול מדי");
		objectKey(path, "x");
		return this.locked(scope.ownerId, async (tx) => {
			await this.folder(tx, scope.folder.id, true);
			await this.availableName(tx, scope.folder.id, validated.filename);
			await tx.execute(
				"INSERT INTO private_archive_folder (id, parent_id, name, path, owner_id) VALUES (?, ?, ?, ?, ?)",
				[id, scope.folder.id, validated.filename, path, scope.folder.ownerId],
			);
			return { id };
		});
	}

	async locked<T>(
		userId: string,
		fn: (tx: Sql, quota: number, allocated: number) => Promise<T>,
	) {
		if (!isUploadId(userId)) throw new UploadError("מזהה משתמש אינו תקין", 401);
		return this.db.transaction(async (tx) => {
			// All quota edits and reservations use this order, including across replicas.
			const [settings] = await tx.query<{ quota: number }>(
				"SELECT quota_bytes AS quota FROM private_upload_settings WHERE id = 1 FOR SHARE",
			);
			const [account] = await tx.query<Account>(
				"SELECT quota_bytes AS quota FROM private_upload_account WHERE user_id = ? FOR UPDATE",
				[userId],
			);
			const [usage] = await tx.query<{ allocated: string }>(
				"SELECT COALESCE(SUM(size_bytes), 0) AS allocated FROM private_upload_file WHERE user_id = ?",
				[userId],
			);
			return fn(
				tx,
				Number(account.quota ?? settings?.quota ?? DEFAULT_QUOTA),
				Number(usage.allocated),
			);
		});
	}

	async directory(
		user: ArchiveUser,
		directoryId = "",
		after = "",
	): Promise<Directory> {
		const cursor = directoryCursor(after);
		const scope = await this.scope(user, directoryId);
		return this.locked(scope.ownerId, async (tx, quota, allocated) => {
			const files = await tx.query<Directory["files"][number]>(
				"(SELECT id, name AS filename, 0 AS size, 0 AS partSize, 'ready' AS status, 'folder' AS kind, CAST(created_at AS CHAR) AS createdAt, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS updatedAt FROM private_archive_folder WHERE parent_id = ? AND (updated_at < ? OR (updated_at = ? AND id < ?)) ORDER BY updated_at DESC, id DESC LIMIT 101) UNION ALL (SELECT id, filename, size_bytes AS size, part_size AS partSize, status, 'file' AS kind, CAST(created_at AS CHAR) AS createdAt, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS updatedAt FROM private_upload_file WHERE directory_id = ? AND (updated_at < ? OR (updated_at = ? AND id < ?)) ORDER BY updated_at DESC, id DESC LIMIT 101) ORDER BY updatedAt DESC, id DESC LIMIT 101",
				[
					scope.folder.id,
					cursor.time,
					cursor.time,
					cursor.id,
					scope.folder.id,
					cursor.time,
					cursor.time,
					cursor.id,
				],
			);
			const displayed: Directory["files"] = [];
			for (let index = 0; index < 100; index++) {
				const file = files[index];
				if (!file) break;
				displayed.push({ ...file, size: Number(file.size) });
			}
			const breadcrumbs: Directory["breadcrumbs"] = [];
			let ancestor = scope.folder;
			for (let depth = 0; depth < 128; depth++) {
				breadcrumbs.unshift({ id: ancestor.id, name: ancestor.name || "/" });
				if (ancestor.id === scope.homeId) break;
				if (!ancestor.parentId) throw new UploadError("התיקייה לא נמצאה", 404);
				ancestor = await this.folder(tx, ancestor.parentId);
			}
			if (breadcrumbs[0]?.id !== scope.homeId)
				throw new UploadError("עומק התיקיות גדול מדי");
			return {
				username: user.name || user.username,
				isAdmin: user.role === "admin",
				id: scope.folder.id,
				homeId: scope.homeId,
				path: `/${scope.folder.path}`,
				quotaName: scope.folder.ownerId
					? scope.folder.path.split("/")[1]
					: user.name || user.username,
				breadcrumbs,
				quota,
				allocated,
				files: displayed,
				nextCursor:
					files.length > 100
						? `${displayed[99].updatedAt}|${displayed[99].id}`
						: null,
			};
		});
	}

	async file(tx: Sql, user: ArchiveUser, id: string): Promise<UploadFile> {
		if (!isUploadId(id)) throw new UploadError("הקובץ לא נמצא", 404);
		const [file] = await tx.query<UploadFile>(
			"SELECT id, user_id AS ownerId, directory_id AS directoryId, object_key AS `key`, filename, size_bytes AS size, part_size AS partSize, upload_id AS uploadId, status, CAST(created_at AS CHAR) AS createdAt, CAST(updated_at AS CHAR) AS updatedAt FROM private_upload_file WHERE id = ? AND (user_id = ? OR ? = 1) FOR UPDATE",
			[id, user.id, user.role === "admin" ? 1 : 0],
		);
		if (!file) throw new UploadError("הקובץ לא נמצא", 404);
		return { ...file, size: Number(file.size) };
	}

	async readFile(user: ArchiveUser, id: string) {
		return this.file(this.db, user, id);
	}

	async lockedFile<T>(
		user: ArchiveUser,
		id: string,
		fn: (tx: Sql, file: UploadFile) => Promise<T>,
	) {
		const file = await this.readFile(user, id);
		return this.locked(file.ownerId, async (tx) =>
			fn(tx, await this.file(tx, user, id)),
		);
	}

	async reserve(
		user: ArchiveUser,
		id: string,
		filename: string,
		size: number,
		partSize: number,
		directoryId = "",
	) {
		if (!isUploadId(id)) throw new UploadError("מזהה קובץ אינו תקין");
		const scope = await this.scope(user, directoryId);
		const key = objectKey(scope.folder.path, filename);
		return this.locked(scope.ownerId, async (tx, quota, allocated) => {
			if (size > quota - allocated)
				throw new UploadError("אין מספיק מקום פנוי בתיקייה", 413);
			await this.folder(tx, scope.folder.id, true);
			await this.availableName(tx, scope.folder.id, filename);
			await tx.execute(
				"INSERT INTO private_upload_file (id, user_id, directory_id, object_key, filename, size_bytes, part_size, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'initializing')",
				[id, scope.ownerId, scope.folder.id, key, filename, size, partSize],
			);
			return { id, partSize };
		});
	}

	async settings() {
		const [settings] = await this.db.query<{ quota: number }>(
			"SELECT quota_bytes AS quota FROM private_upload_settings WHERE id = 1",
		);
		const users = await this.db.query<{
			userId: string;
			username: string;
			displayName: string;
			quota: number | null;
			allocated: number;
		}>(
			"SELECT a.user_id AS userId, a.username, COALESCE(d.name, a.username) AS displayName, a.quota_bytes AS quota, COALESCE(SUM(f.size_bytes), 0) AS allocated FROM private_upload_account a LEFT JOIN private_archive_folder d ON d.id = a.home_directory_id LEFT JOIN private_upload_file f ON f.user_id = a.user_id GROUP BY a.user_id, a.username, a.quota_bytes, d.name ORDER BY a.username",
		);
		return {
			quota: Number(settings?.quota ?? DEFAULT_QUOTA),
			users: users.map((user) => ({
				...user,
				quota: user.quota === null ? null : Number(user.quota),
				allocated: Number(user.allocated),
			})),
		};
	}

	async setQuota(bytes: number | null, userId?: string) {
		if (bytes !== null && (!Number.isSafeInteger(bytes) || bytes < 0))
			throw new UploadError("מכסה אינה תקינה");
		return this.db.transaction(async (tx) => {
			await tx.query(
				"SELECT id FROM private_upload_settings WHERE id = 1 FOR UPDATE",
			);
			if (userId !== undefined) {
				if (!isUploadId(userId)) throw new UploadError("מזהה משתמש אינו תקין");
				await tx.execute(
					"UPDATE private_upload_account SET quota_bytes = ? WHERE user_id = ?",
					[bytes, userId],
				);
			} else {
				if (bytes === null) throw new UploadError("יש להזין מכסת ברירת מחדל");
				await tx.execute(
					"UPDATE private_upload_settings SET quota_bytes = ? WHERE id = 1",
					[bytes],
				);
			}
		});
	}
}
