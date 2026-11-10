import {
	DEFAULT_QUOTA,
	type Directory,
	UploadError,
	type UploadFile,
	UUID,
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

export class UploadStore {
	constructor(private db: UploadDatabase) {}

	async locked<T>(
		userId: string,
		username: string,
		fn: (tx: Sql, quota: number, allocated: number) => Promise<T>,
	) {
		if (!UUID.test(userId)) throw new UploadError("מזהה משתמש אינו תקין", 401);
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

	async directory(userId: string, username: string): Promise<Directory> {
		return this.locked(userId, username, async (tx, quota, allocated) => {
			const files = await tx.query<UploadFile>(
				"SELECT id, filename, size_bytes AS size, part_size AS partSize, status, CAST(created_at AS CHAR) AS createdAt FROM private_upload_file WHERE user_id = ? ORDER BY created_at DESC, id",
				[userId],
			);
			return {
				username,
				quota,
				allocated,
				files: files.map((file) => ({ ...file, size: Number(file.size) })),
			};
		});
	}

	async file(tx: Sql, userId: string, id: string): Promise<UploadFile> {
		if (!UUID.test(id)) throw new UploadError("הקובץ לא נמצא", 404);
		const [file] = await tx.query<UploadFile>(
			"SELECT id, filename, size_bytes AS size, part_size AS partSize, upload_id AS uploadId, status, CAST(created_at AS CHAR) AS createdAt FROM private_upload_file WHERE user_id = ? AND id = ? FOR UPDATE",
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
				if (typeof userId !== "string" || !UUID.test(userId))
					throw new UploadError("מזהה משתמש אינו תקין");
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
