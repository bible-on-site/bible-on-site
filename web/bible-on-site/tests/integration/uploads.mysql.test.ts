/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/uploads/store", () => ({
	uploadStore: { locked: jest.fn(), file: jest.fn(), readFile: jest.fn() },
}));

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	CreateBucketCommand,
	DeleteBucketCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import type { Pool, PoolConnection } from "mysql2/promise";
import {
	beginUpload,
	completeUpload,
	downloadUpload,
	removeUpload,
	uploadPart,
} from "@/lib/uploads/storage";
import { uploadStore } from "@/lib/uploads/store";
import { type Sql, UploadStore } from "../../../shared/private-upload-store";

// Opt-in: actual MySQL + private RustFS, with a freshly generated disposable schema/bucket.
const integration = process.env.UPLOAD_INTEGRATION_DB_URL
	? describe
	: describe.skip;
integration("private upload MySQL/S3 integration", () => {
	const database = `private_upload_test_${Date.now()}`;
	const bucket = `private-upload-test-${randomUUID()}`;
	const alice = { id: randomUUID(), username: "alice" };
	const bob = { id: randomUUID(), username: "bob" };
	const schema = readFileSync(
		path.resolve(
			__dirname,
			"../../../../data/mysql/private_upload_upgrade.sql",
		),
		"utf8",
	)
		.replace(/^--.*$/gm, "")
		.split(";")
		.filter((statement) => statement.trim());
	async function migrate(connection: PoolConnection) {
		// Session variables and prepared DDL must stay on the same connection.
		// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- DDL is read from the fixed repository migration, never from request data.
		for (const statement of schema) await connection.query(statement);
	}
	let pool: Pool;
	let store: UploadStore;
	let s3: S3Client;
	let failCommitAfter = 0;
	beforeAll(async () => {
		const mysql = jest.requireActual("mysql2/promise");
		const url = new URL(process.env.UPLOAD_INTEGRATION_DB_URL as string);
		const root = await mysql.createConnection(url.href);
		await root.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
		await root.end();
		url.pathname = `/${database}`;
		pool = mysql.createPool(url.href);
		// Idempotence is part of the rollout contract.
		const migration = await pool.getConnection();
		try {
			await migrate(migration);
			await migrate(migration);
		} finally {
			migration.release();
		}
		const sql = (connection: Pick<Pool, "execute">): Sql => ({
			query: async <T>(statement: string, params?: unknown[]) => {
				// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- fixed parameterized store SQL; values are bound separately in this isolated test schema.
				return (await connection.execute(statement, params as never))[0] as T[];
			},
			execute: async (statement, params) => {
				// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- fixed parameterized store SQL; values are bound separately in this isolated test schema.
				return connection.execute(statement, params as never);
			},
		});
		store = new UploadStore({
			...sql(pool),
			transaction: async (fn) => {
				const conn = await pool.getConnection();
				try {
					await conn.beginTransaction();
					const result = await fn(sql(conn));
					if (failCommitAfter > 0 && --failCommitAfter === 0)
						throw new Error("simulated commit failure");
					await conn.commit();
					return result;
				} catch (error) {
					await conn.rollback();
					throw error;
				} finally {
					conn.release();
				}
			},
		});
		for (const key of ["locked", "file", "readFile"] as const)
			(uploadStore[key] as jest.Mock).mockImplementation(
				store[key].bind(store),
			);
		Object.assign(process.env, {
			UPLOAD_S3_BUCKET: bucket,
			UPLOAD_S3_ENDPOINT: "http://127.0.0.1:4577",
			UPLOAD_AWS_REGION: "us-east-1",
			AWS_ACCESS_KEY_ID: "test",
			AWS_SECRET_ACCESS_KEY: "test_1234",
		});
		s3 = new S3Client({
			endpoint: process.env.UPLOAD_S3_ENDPOINT,
			region: "us-east-1",
			forcePathStyle: true,
			credentials: { accessKeyId: "test", secretAccessKey: "test_1234" },
		});
		await s3.send(new CreateBucketCommand({ Bucket: bucket }));
		await store.directory(alice.id, alice.username);
		await store.directory(bob.id, bob.username);
	});
	afterEach(() => {
		failCommitAfter = 0;
	});
	afterAll(async () => {
		if (store)
			for (const user of [alice, bob])
				for (const file of (await store.directory(user.id, user.username))
					.files)
					await removeUpload(user, file.id);
		if (s3) {
			await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
			s3.destroy();
		}
		if (pool) {
			await pool.query(`DROP DATABASE ${database}`);
			await pool.end();
		}
	});
	it("upgrades the original schema repeatedly without losing files or quota overrides", async () => {
		const connection = await pool.getConnection();
		const legacyId = randomUUID();
		try {
			await connection.query("DROP TABLE private_upload_file");
			await connection.query(`CREATE TABLE private_upload_file (
				id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
				user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
				filename VARCHAR(255) NOT NULL,
				size_bytes BIGINT UNSIGNED NOT NULL,
				part_size INT UNSIGNED NOT NULL,
				upload_id TEXT NULL,
				status ENUM('uploading', 'ready') NOT NULL DEFAULT 'uploading',
				created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
				INDEX user_files (user_id, created_at),
				FOREIGN KEY (user_id) REFERENCES private_upload_account(user_id)
			) ENGINE=InnoDB`);
			await store.setQuota(12345, alice.id);
			await connection.execute(
				"INSERT INTO private_upload_file (id, user_id, filename, size_bytes, part_size, upload_id, status, created_at) VALUES (?, ?, 'legacy.binary', 42, 8388608, 'legacy-multipart', 'uploading', '2020-01-02 03:04:05')",
				[legacyId, alice.id],
			);
			await migrate(connection);
			await migrate(connection);
			const upgraded = await store.directory(alice.id, alice.username);
			expect(upgraded.quota).toBe(12345);
			expect(upgraded.allocated).toBe(42);
			expect(upgraded.files).toEqual([
				expect.objectContaining({
					id: legacyId,
					filename: "legacy.binary",
					size: 42,
					status: "uploading",
					updatedAt: "2020-01-02 03:04:05.000000",
				}),
			]);
			const [indexes] = await connection.query(
				"SELECT COLUMN_NAME, COLLATION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_file' AND INDEX_NAME = 'user_files' ORDER BY SEQ_IN_INDEX",
			);
			expect(indexes).toEqual([
				{ COLUMN_NAME: "user_id", COLLATION: "A" },
				{ COLUMN_NAME: "updated_at", COLLATION: "D" },
				{ COLUMN_NAME: "id", COLLATION: "D" },
			]);
			await connection.execute(
				"UPDATE private_upload_file SET status = 'deleting' WHERE id = ?",
				[legacyId],
			);
			expect(
				(await store.directory(alice.id, alice.username)).files[0],
			).toMatchObject({
				status: "deleting",
				updatedAt: expect.not.stringContaining("2020-01-02"),
			});
		} finally {
			await connection.execute("DELETE FROM private_upload_file WHERE id = ?", [
				legacyId,
			]);
			await store.setQuota(null, alice.id);
			connection.release();
		}
	});
	it("round-trips multipart binary data and rejects cross-user access", async () => {
		const content = Buffer.from([0, 1, 255, 16, 32]);
		const started = await beginUpload(alice, "קובץ.custom", content.length);
		await expect(downloadUpload(bob, started.id)).rejects.toMatchObject({
			status: 404,
		});
		await expect(removeUpload(bob, started.id)).rejects.toMatchObject({
			status: 404,
		});
		await expect(completeUpload(bob, started.id)).rejects.toMatchObject({
			status: 404,
		});
		await expect(
			uploadPart(
				bob,
				started.id,
				1,
				new Request("http://local", { method: "PUT", body: content }),
			),
		).rejects.toMatchObject({ status: 404 });
		await uploadPart(
			alice,
			started.id,
			1,
			new Request("http://local", { method: "PUT", body: content }),
		);
		await completeUpload(alice, started.id);
		const result = await downloadUpload(alice, started.id);
		expect(Buffer.from(await new Response(result.body).arrayBuffer())).toEqual(
			content,
		);
		expect((await store.directory(bob.id, bob.username)).files).toEqual([]);
		expect(
			(
				await fetch(
					`${process.env.UPLOAD_S3_ENDPOINT}/${bucket}/users/${alice.id}/${started.id}`,
				)
			).status,
		).toBe(403);
		await removeUpload(alice, started.id);
		expect((await store.directory(alice.id, alice.username)).allocated).toBe(0);
	});
	it("streams multiple real S3 parts and refuses premature completion", async () => {
		const content = Buffer.alloc(8 * 1024 * 1024 + 3, 0xab);
		const started = await beginUpload(alice, "large.binary", content.length);
		await uploadPart(
			alice,
			started.id,
			1,
			new Request("http://local", {
				method: "PUT",
				body: content.subarray(0, started.partSize),
			}),
		);
		await expect(completeUpload(alice, started.id)).rejects.toMatchObject({
			status: 400,
		});
		await uploadPart(
			alice,
			started.id,
			2,
			new Request("http://local", {
				method: "PUT",
				body: content.subarray(started.partSize),
			}),
		);
		await completeUpload(alice, started.id);
		const result = await downloadUpload(alice, started.id);
		const downloaded = Buffer.from(
			await new Response(result.body).arrayBuffer(),
		);
		expect(downloaded.byteLength).toBe(content.byteLength);
		expect(createHash("sha256").update(downloaded).digest("hex")).toBe(
			createHash("sha256").update(content).digest("hex"),
		);
		await removeUpload(alice, started.id);
	});
	it("records empty files durably before S3 writes and recovers preparation failures", async () => {
		failCommitAfter = 1;
		await expect(beginUpload(alice, "never-written", 0)).rejects.toThrow(
			"simulated commit failure",
		);
		expect(
			(await store.directory(alice.id, alice.username)).files,
		).toHaveLength(0);
		failCommitAfter = 2;
		await expect(beginUpload(alice, "tracked-empty", 0)).rejects.toThrow(
			"simulated commit failure",
		);
		const [tracked] = (await store.directory(alice.id, alice.username)).files;
		expect(tracked.status).toBe("initializing");
		await completeUpload(alice, tracked.id);
		await removeUpload(alice, tracked.id);
	});
	it("never resurrects a ready row after S3 deletion and a failed database commit", async () => {
		const started = await beginUpload(alice, "delete-recovery", 2);
		await uploadPart(
			alice,
			started.id,
			1,
			new Request("http://local", { method: "PUT", body: "ab" }),
		);
		await completeUpload(alice, started.id);
		failCommitAfter = 2;
		await expect(removeUpload(alice, started.id)).rejects.toThrow(
			"simulated commit failure",
		);
		const [pending] = (await store.directory(alice.id, alice.username)).files;
		expect(pending.status).toBe("deleting");
		await expect(downloadUpload(alice, started.id)).rejects.toMatchObject({
			status: 409,
		});
		await removeUpload(alice, started.id);
		expect(
			(await store.directory(alice.id, alice.username)).files,
		).toHaveLength(0);
	});
	it("pages by modification time and places completed uploads on the newest page", async () => {
		try {
			for (let index = 0; index < 101; index++)
				await pool.execute(
					"INSERT INTO private_upload_file (id, user_id, filename, size_bytes, part_size, status, updated_at) VALUES (?, ?, 'pagination-seed', 0, 8388608, 'ready', '2000-01-01 00:00:00.000000')",
					[randomUUID(), alice.id],
				);
			const first = await store.directory(alice.id, alice.username);
			expect(first.files).toHaveLength(100);
			const second = await store.directory(
				alice.id,
				alice.username,
				first.nextCursor as string,
			);
			expect(second.files).toHaveLength(1);
			expect(
				new Set([...first.files, ...second.files].map((file) => file.id)).size,
			).toBe(101);
			const fresh = await beginUpload(alice, "newly-completed", 2);
			await pool.execute(
				"UPDATE private_upload_file SET updated_at = '1999-01-01 00:00:00.000000' WHERE user_id = ? AND id = ?",
				[alice.id, fresh.id],
			);
			await uploadPart(
				alice,
				fresh.id,
				1,
				new Request("http://local", { method: "PUT", body: "ab" }),
			);
			await completeUpload(alice, fresh.id);
			expect(
				(await store.directory(alice.id, alice.username)).files[0].id,
			).toBe(fresh.id);
			await removeUpload(alice, fresh.id);
		} finally {
			await pool.execute(
				"DELETE FROM private_upload_file WHERE user_id = ? AND filename = 'pagination-seed'",
				[alice.id],
			);
		}
	});
	it("serializes parallel reservations and releases space after cancellation", async () => {
		await store.setQuota(10);
		const attempts = await Promise.allSettled([
			beginUpload(alice, "one", 7),
			beginUpload(alice, "two", 7),
		]);
		expect(
			attempts.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			attempts.filter((result) => result.status === "rejected"),
		).toHaveLength(1);
		expect((await store.directory(alice.id, alice.username)).allocated).toBe(7);
		const [pending] = (await store.directory(alice.id, alice.username)).files;
		await removeUpload(alice, pending.id);
		expect((await store.directory(alice.id, alice.username)).allocated).toBe(0);
		const started = await beginUpload(alice, "empty", 0);
		await completeUpload(alice, started.id);
		expect(
			(await store.directory(alice.id, alice.username)).files[0].status,
		).toBe("ready");
	});
	it("enforces overrides, default restoration and reduced quotas without deleting files", async () => {
		await store.setQuota(2, alice.id);
		await expect(beginUpload(alice, "too-large", 3)).rejects.toMatchObject({
			status: 413,
		});
		await store.setQuota(null, alice.id);
		const file = await beginUpload(alice, "pending", 5);
		await store.setQuota(0);
		await expect(beginUpload(alice, "blocked", 1)).rejects.toMatchObject({
			status: 413,
		});
		expect(
			(await store.directory(alice.id, alice.username)).files,
		).toHaveLength(2);
		await removeUpload(alice, file.id);
	});
});
