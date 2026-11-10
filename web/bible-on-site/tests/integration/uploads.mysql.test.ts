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
import type { Pool } from "mysql2/promise";
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
	let pool: Pool;
	let store: UploadStore;
	let s3: S3Client;
	beforeAll(async () => {
		const mysql = jest.requireActual("mysql2/promise");
		const url = new URL(process.env.UPLOAD_INTEGRATION_DB_URL as string);
		const root = await mysql.createConnection(url.href);
		await root.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
		await root.end();
		url.pathname = `/${database}`;
		pool = mysql.createPool(url.href);
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
		// Idempotence is part of the rollout contract.
		for (let attempt = 0; attempt < 2; attempt++)
			for (const statement of schema) await pool.query(statement);
		const sql = (connection: Pick<Pool, "execute">): Sql => ({
			query: async <T>(statement: string, params?: unknown[]) =>
				(await connection.execute(statement, params as never))[0] as T[],
			execute: async (statement, params) =>
				connection.execute(statement, params as never),
		});
		store = new UploadStore({
			...sql(pool),
			transaction: async (fn) => {
				const conn = await pool.getConnection();
				try {
					await conn.beginTransaction();
					const result = await fn(sql(conn));
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
