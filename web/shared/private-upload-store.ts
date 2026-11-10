import {
	DEFAULT_QUOTA,
	type Directory,
	isUploadId,
	UploadError,
	type UploadFile,
} from "./private-upload";

export interface Sql {
	query<T>(sql: string, params?: unknown[]): Promise<T[]>;
	execute(sql: string, params?: unknown[]): Promise<unknown>;
}
export interface UploadDatabase extends Sql {
	transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}
interface Account {
	quota: number | null;
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

export class UploadStore {
	constructor(private db: UploadDatabase) {}

	async locked<T>(
		userId: string,
		username: string,
		fn: (tx: Sql, quota: number, allocated: number) => Promise<T>,
	) {
		if (!isUploadId(userId)) throw new UploadError("מזהה משתמש אינו תקין", 401);
		return this.db.transaction(async (tx) => {
			// All quota edits and reservations use this order, including across replicas.
			const [settings] = await tx.query<{ quota: number }>(
				"SELECT quota_bytes AS quota FROM private_upload_settings WHERE id = 1 FOR SHARE",
			);
			await tx.execute(
				"INSERT INTO private_upload_account (user_id, username) VALUES (?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)",
				[userId, username],
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
		userId: string,
		username: string,
		after = "",
	): Promise<Directory> {
		const cursor = directoryCursor(after);
		return this.locked(userId, username, async (tx, quota, allocated) => {
			const files = await tx.query<UploadFile>(
				"SELECT id, filename, size_bytes AS size, part_size AS partSize, status, CAST(created_at AS CHAR) AS createdAt, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS updatedAt FROM private_upload_file WHERE user_id = ? AND (updated_at < ? OR (updated_at = ? AND id < ?)) ORDER BY updated_at DESC, id DESC LIMIT 101",
				[userId, cursor.time, cursor.time, cursor.id],
			);
			const displayed: Directory["files"] = [];
			for (let index = 0; index < 100; index++) {
				const file = files[index];
				if (!file) break;
				displayed.push({ ...file, size: Number(file.size) });
			}
			return {
				username,
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

	async file(tx: Sql, userId: string, id: string): Promise<UploadFile> {
		if (!isUploadId(id)) throw new UploadError("הקובץ לא נמצא", 404);
		const [file] = await tx.query<UploadFile>(
			"SELECT id, filename, size_bytes AS size, part_size AS partSize, upload_id AS uploadId, status, CAST(created_at AS CHAR) AS createdAt, CAST(updated_at AS CHAR) AS updatedAt FROM private_upload_file WHERE user_id = ? AND id = ? FOR UPDATE",
			[userId, id],
		);
		if (!file) throw new UploadError("הקובץ לא נמצא", 404);
		return { ...file, size: Number(file.size) };
	}

	async readFile(userId: string, id: string) {
		return this.file(this.db, userId, id);
	}

	async settings() {
		const [settings] = await this.db.query<{ quota: number }>(
			"SELECT quota_bytes AS quota FROM private_upload_settings WHERE id = 1",
		);
		const users = await this.db.query<{
			userId: string;
			username: string;
			quota: number | null;
			allocated: number;
		}>(
			"SELECT a.user_id AS userId, a.username, a.quota_bytes AS quota, COALESCE(SUM(f.size_bytes), 0) AS allocated FROM private_upload_account a LEFT JOIN private_upload_file f ON f.user_id = a.user_id GROUP BY a.user_id, a.username, a.quota_bytes ORDER BY a.username",
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
